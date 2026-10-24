import { describe, expect, it } from "bun:test";
import type { GitClient, GitInvocationResult } from "@/domain/git/git.types";
import { readRepositorySnapshot } from "@/domain/repository/repository.read";
import { EMPTY_UPSTREAM_EVIDENCE } from "@/domain/repository/repository.upstream";
import { createFakeGitClient, fakeGitResult } from "@/test/git.fake";

/**
 * Builds the read options for one fixture root.
 *
 * @returns Options accepted by `readRepositorySnapshot`.
 */
function readOptions() {
  return {
    cwd: "/repo",
    signal: new AbortController().signal,
    now: () => 1_000,
    evidence: EMPTY_UPSTREAM_EVIDENCE,
  };
}

/**
 * Wraps a fake client and overrides one command.
 *
 * @param base - Base fake client.
 * @param key - Joined arguments to override.
 * @param result - Result to return for that command.
 * @returns The wrapped client.
 */
function overrideCommand(base: GitClient, key: string, result: GitInvocationResult): GitClient {
  return {
    gitPath: base.gitPath,
    invoke: async (options) =>
      options.args.join(" ") === key ? result : await base.invoke(options),
  };
}

describe("readRepositorySnapshot", () => {
  it("uses one resolved upstream value for the snapshot and the signals", async () => {
    const fake = createFakeGitClient();
    const client = overrideCommand(
      fake.client,
      "for-each-ref --format=%(upstream:remotename)%09%(upstream:remoteref) refs/heads/main",
      fakeGitResult("", false, "fatal: unable to read refs"),
    );

    const result = await readRepositorySnapshot(client, readOptions());

    expect(result.ok).toBeTrue();
    expect(result.snapshot?.upstream).toBe("origin/main");
    expect(result.signals.upstream).toBe("origin/main");
    expect(result.upstreamStatus).toBe("unknown");
    expect(result.signals.upstreamCheck).toBe("unknown");
  });

  it("keeps a slash-named upstream remote whole in the snapshot", async () => {
    const fake = createFakeGitClient();
    const onFoo = overrideCommand(
      fake.client,
      "symbolic-ref -q --short HEAD",
      fakeGitResult("foo\n"),
    );
    const withAtoms = overrideCommand(
      onFoo,
      "for-each-ref --format=%(upstream:remotename)%09%(upstream:remoteref) refs/heads/foo",
      fakeGitResult("a/b\trefs/heads/main\n"),
    );
    const client = overrideCommand(
      withAtoms,
      "rev-parse --verify --quiet refs/remotes/a/b/main",
      fakeGitResult("abc123\n"),
    );

    const result = await readRepositorySnapshot(client, readOptions());

    expect(result.snapshot?.upstream).toBe("a/b/main");
    expect(result.upstreamStatus).toBe("healthy");
    expect(result.signals.upstream).toBe("a/b/main");
  });

  it("resolves whether any local branch has an upstream", async () => {
    const fake = createFakeGitClient();

    const withUpstream = await readRepositorySnapshot(fake.client, readOptions());

    expect(withUpstream.signals.hasUpstreamBranches).toBeTrue();

    const withoutUpstream = await readRepositorySnapshot(
      overrideCommand(
        fake.client,
        "for-each-ref --format=%(upstream:short) refs/heads",
        fakeGitResult(""),
      ),
      readOptions(),
    );

    expect(withoutUpstream.signals.hasUpstreamBranches).toBeFalse();

    const unknown = await readRepositorySnapshot(
      overrideCommand(
        fake.client,
        "for-each-ref --format=%(upstream:short) refs/heads",
        fakeGitResult("", false, "fatal: unable to read refs"),
      ),
      readOptions(),
    );

    expect(unknown.signals.hasUpstreamBranches).toBeTrue();
  });

  it("fails the read when git remote -v output is truncated", async () => {
    const fake = createFakeGitClient();
    const client = overrideCommand(fake.client, "remote -v", {
      ...fakeGitResult("origin\tgit@example.com:repo.git (fetch)\n"),
      stdoutTruncated: true,
    });

    const result = await readRepositorySnapshot(client, readOptions());

    expect(result.ok).toBeFalse();
    expect(result.snapshot).toBeNull();
    expect(result.error).toBe("git remote -v output was truncated");
    expect(result.signals.loaded).toBeFalse();
  });

  it("keeps a genuine not-a-repository classification", async () => {
    const fake = createFakeGitClient();
    const failure = fakeGitResult("", false, "fatal: not a git repository");
    const client = overrideCommand(fake.client, "rev-parse --is-inside-work-tree", failure);

    const result = await readRepositorySnapshot(client, readOptions());

    expect(result.ok).toBeTrue();
    expect(result.snapshot).toBeNull();
    expect(result.signals.notARepository).toBeTrue();
  });

  it("never turns a cancelled probe into a not-a-repository state", async () => {
    const fake = createFakeGitClient();
    const cancelled: GitInvocationResult = {
      ...fakeGitResult("", false),
      cancelled: true,
      exitCode: null,
    };
    const client = overrideCommand(fake.client, "rev-parse --is-inside-work-tree", cancelled);

    const result = await readRepositorySnapshot(client, readOptions());

    expect(result.ok).toBeFalse();
    expect(result.failureKind).toBe("cancelled");
    expect(result.signals.notARepository).toBeFalse();
    expect(result.signals.loaded).toBeFalse();
  });
});
