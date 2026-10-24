import { describe, expect, it } from "bun:test";
import { executeRemoteFetch } from "@/domain/commands/commands.fetch";
import type { CommandHandlerContext, CommandProgress } from "@/domain/commands/commands.types";
import type { GitClient } from "@/domain/git/git.types";
import { isGitAvailable, withGitFixture } from "@/test/git.fixture";

const gitAvailable = isGitAvailable();

/**
 * Builds a handler context bound to one fixture repository.
 *
 * @param client - Production client from the fixture.
 * @param cwd - Repository root.
 * @returns The handler context with a never-aborted signal.
 */
function createContext(client: GitClient, cwd: string): CommandHandlerContext {
  const progress: CommandProgress[] = [];

  return {
    request: { commandId: "remote.fetch", target: { kind: "none" } },
    target: { kind: "none" },
    cwd,
    client,
    signal: new AbortController().signal,
    notifyProgress: (event) => progress.push(event),
  };
}

describe.skipIf(!gitAvailable)("remote.fetch against a real repository", () => {
  it("force-updates the remote-tracking ref after an amended upstream is force-pushed", async () => {
    await withGitFixture({ bare: true, seed: false }, async (upstream) => {
      await withGitFixture({}, async (fixture) => {
        const added = await fixture.run(["remote", "add", "origin", upstream.root], {
          operationClass: "write",
        });
        expect(added.ok).toBeTrue();

        const pushed = await fixture.run(["push", "-u", "origin", "main"], {
          operationClass: "network",
        });
        expect(pushed.ok).toBeTrue();

        const oldOid = (await fixture.run(["rev-parse", "HEAD"])).stdout.trim();

        fixture.writeFile("README.md", "amended fixture\n");
        const amended = await fixture.run(
          ["commit", "--amend", "-m", "Amended seed", "--no-gpg-sign"],
          { operationClass: "write" },
        );
        expect(amended.ok).toBeTrue();

        const newOid = (await fixture.run(["rev-parse", "HEAD"])).stdout.trim();

        expect(newOid).not.toBe(oldOid);

        const forced = await fixture.run(["push", "--force", "origin", "main"], {
          operationClass: "network",
        });
        expect(forced.ok).toBeTrue();

        // Model a clone whose remote-tracking ref still points at the pre-amend commit, which is the
        // state a second checkout has after another clone force-pushes the rewritten history.
        const reset = await fixture.run(["update-ref", "refs/remotes/origin/main", oldOid], {
          operationClass: "write",
        });
        expect(reset.ok).toBeTrue();
        expect((await fixture.run(["rev-parse", "refs/remotes/origin/main"])).stdout.trim()).toBe(
          oldOid,
        );

        const outcome = await executeRemoteFetch(createContext(fixture.client, fixture.root));

        expect(outcome.steps).toHaveLength(1);
        expect(outcome.steps[0]?.exitCode).toBe(0);
        expect(outcome.steps[0]?.argv).toContain("+refs/heads/main:refs/remotes/origin/main");
        expect(outcome.remoteResults).toEqual([{ remote: "origin", succeeded: true }]);
        expect((await fixture.run(["rev-parse", "refs/remotes/origin/main"])).stdout.trim()).toBe(
          newOid,
        );
      });
    });
  });
});
