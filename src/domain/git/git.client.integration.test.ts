import { describe, expect, it } from "bun:test";
import { createGitClient } from "@/domain/git/git.client";
import { classifyGitFailure } from "@/domain/git/git.errors";
import { isGitAvailable, withGitFixture } from "@/test/git.fixture";

const gitAvailable = isGitAvailable();

describe.skipIf(!gitAvailable)("git client against a real repository", () => {
  it("runs the canonical status read from the repository root", async () => {
    await withGitFixture({}, async (fixture) => {
      const result = await fixture.run([
        "status",
        "--porcelain=v2",
        "--branch",
        "-z",
        "--untracked-files=all",
      ]);

      expect(result.ok).toBeTrue();
      expect(result.cwd).toBe(fixture.root);
      expect(result.argv[0]).toBe("git");
      expect(result.stdout).toContain("# branch.head main");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  it("does not hang when a hook reads stdin", async () => {
    await withGitFixture({}, async (fixture) => {
      fixture.createHook("pre-commit", "#!/bin/sh\nread line\nexit 0\n");
      fixture.writeFile("file.txt", "change\n");

      const result = await fixture.commit("hook reads stdin", { timeoutMs: 5_000 });

      expect(result.ok).toBeTrue();
      expect(result.stderr).not.toContain("timed out");
    });
  });

  it("times out a slow hook through the escalation path", async () => {
    await withGitFixture({}, async (fixture) => {
      fixture.createHook("pre-commit", "#!/bin/sh\nsleep 5\n");
      fixture.writeFile("file.txt", "change\n");

      const startedAt = Date.now();
      const result = await fixture.commit("slow", { timeoutMs: 1_000 });
      const elapsed = Date.now() - startedAt;

      expect(result.timedOut).toBeTrue();
      expect(result.cancelled).toBeFalse();
      expect(result.ok).toBeFalse();
      expect(result.timedOutAfterMs).toBe(1_000);
      expect(elapsed).toBeLessThan(4_500);

      const failure = classifyGitFailure(result);

      expect(failure.kind).toBe("timed-out");
      expect(failure.message).toBe("timed out after 1 seconds");
    });
  });

  it("cancels an in-flight command through its signal", async () => {
    await withGitFixture({}, async (fixture) => {
      fixture.writeFile("file.txt", "change\n");
      await fixture.run(["add", "-A"], { operationClass: "write" });
      fixture.createHook("pre-commit", "#!/bin/sh\nsleep 5\n");

      const controller = new AbortController();
      const pending = fixture.run(["commit", "-m", "slow"], {
        operationClass: "write",
        signal: controller.signal,
      });

      setTimeout(() => controller.abort(), 100);
      const result = await pending;

      expect(result.cancelled).toBeTrue();
      expect(result.timedOut).toBeFalse();
      expect(result.ok).toBeFalse();
      expect(classifyGitFailure(result).kind).toBe("cancelled");
    });
  });

  it("escalates to SIGKILL when the child ignores SIGTERM", async () => {
    await withGitFixture({}, async (fixture) => {
      const marker = fixture.resolvePath("trap-ready");
      const killGraceMs = 300;
      fixture.createHook(
        "terminal",
        `#!/bin/sh\ntrap '' TERM\n: > '${marker}'\nwhile :; do :; done\n`,
      );
      const script = fixture.resolvePath(".git/hooks/terminal");
      const client = createGitClient({ gitPath: script, killGraceMs });
      const controller = new AbortController();
      const pending = client.invoke({
        args: ["status"],
        cwd: fixture.root,
        signal: controller.signal,
        operationClass: "read",
        timeoutMs: 30_000,
        sshCommandConfigured: true,
      });

      expect(await waitForPath(marker)).toBeTrue();

      const abortAt = Date.now();

      controller.abort();

      const result = await pending;
      const elapsed = Date.now() - abortAt;

      expect(result.timedOut).toBeFalse();
      expect(result.ok).toBeFalse();
      expect(result.terminationSignal).toBe("SIGKILL");
      expect(elapsed).toBeGreaterThanOrEqual(killGraceMs);
      expect(elapsed).toBeLessThan(killGraceMs + 2_000);
    });
  });

  it("settles after a normal exit even when a descendant holds the output pipes", async () => {
    await withGitFixture({}, async (fixture) => {
      fixture.createHook("pipe-holder", "#!/bin/sh\nsleep 3 &\nexit 0\n");
      const script = fixture.resolvePath(".git/hooks/pipe-holder");
      const client = createGitClient({ gitPath: script, killGraceMs: 300 });
      const startedAt = Date.now();
      const result = await client.invoke({
        args: ["status"],
        cwd: fixture.root,
        signal: new AbortController().signal,
        operationClass: "read",
        timeoutMs: 5_000,
        sshCommandConfigured: true,
      });
      const elapsed = Date.now() - startedAt;

      expect(result.ok).toBeTrue();
      expect(result.exitCode).toBe(0);
      expect(result.timedOut).toBeFalse();
      expect(elapsed).toBeLessThan(1_500);
    });
  });

  it("reports a missing executable as missing git", async () => {
    const client = createGitClient({
      gitPath: "gitminal-missing-git-binary",
      resolveSshCommandConfigured: async () => false,
    });
    const result = await client.invoke({
      args: ["status"],
      cwd: process.cwd(),
      signal: new AbortController().signal,
      operationClass: "read",
      sshCommandConfigured: true,
    });

    expect(result.ok).toBeFalse();
    expect(result.spawnError?.code).toBe("ENOENT");
    expect(classifyGitFailure(result).kind).toBe("missing-git");
  });
});

/**
 * Waits until the child creates its readiness marker.
 *
 * The marker proves the shell installed its SIGTERM trap before the test aborts, which makes the
 * SIGKILL escalation deterministic instead of depending on cold-start timing.
 *
 * @param path - Absolute marker path.
 * @returns True when the marker appeared before the deadline.
 */
async function waitForPath(path: string): Promise<boolean> {
  const deadline = Date.now() + 5_000;

  while (!(await Bun.file(path).exists())) {
    if (Date.now() > deadline) {
      return false;
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  return true;
}
