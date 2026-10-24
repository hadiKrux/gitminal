import { describe, expect, it } from "bun:test";
import { readRemotes } from "@/domain/git/git.remotes";
import { readStatus } from "@/domain/git/git.status";
import { isGitAvailable, withGitFixture } from "@/test/git.fixture";

const gitAvailable = isGitAvailable();

/**
 * Creates a never-aborted signal for one read.
 *
 * @returns The signal.
 */
function signal(): AbortSignal {
  return new AbortController().signal;
}

describe.skipIf(!gitAvailable)("canonical status against a real repository", () => {
  it("parses modifications, a rename, and an untracked path with spaces", async () => {
    await withGitFixture({}, async (fixture) => {
      fixture.writeFile("tracked.txt", "base\n");
      await fixture.commit("Add tracked file");
      await fixture.run(["mv", "tracked.txt", "renamed.txt"], { operationClass: "write" });
      fixture.writeFile("renamed.txt", "changed\n");
      fixture.writeFile("new file.txt", "new\n");

      const result = await readStatus(fixture.client, {
        cwd: fixture.root,
        signal: signal(),
      });

      expect(result.ok).toBeTrue();

      const snapshot = result.snapshot;
      expect(snapshot).not.toBeNull();
      expect(snapshot?.branch).toBe("main");
      expect(snapshot?.headOid).not.toBeNull();
      expect(snapshot?.detached).toBeFalse();
      expect(snapshot?.untrackedCount).toBe(1);
      expect(snapshot?.entries.map((entry) => entry.path)).toContain("new file.txt");

      const rename = snapshot?.entries.find((entry) => entry.path === "renamed.txt");

      expect(rename?.kind).toBe("renamed");
      expect(rename?.originalPath).toBe("tracked.txt");
    });
  });

  it("reads a configured remote", async () => {
    await withGitFixture({}, async (fixture) => {
      await fixture.run(["remote", "add", "origin", "https://example.invalid/repo.git"], {
        operationClass: "write",
      });

      const remotes = await readRemotes(fixture.client, {
        cwd: fixture.root,
        signal: signal(),
      });

      expect(remotes.ok).toBeTrue();
      expect(remotes.remotes).toEqual([
        {
          name: "origin",
          fetchUrl: "https://example.invalid/repo.git",
          pushUrl: null,
        },
      ]);
    });
  });

  it("returns an empty remote list when none is configured", async () => {
    await withGitFixture({}, async (fixture) => {
      const remotes = await readRemotes(fixture.client, {
        cwd: fixture.root,
        signal: signal(),
      });

      expect(remotes).toEqual({ ok: true, remotes: [], failure: null });
    });
  });
});
