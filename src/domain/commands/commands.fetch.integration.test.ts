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
  it.each(["+refs/heads/main:refs/heads/protected", "+refs/*:refs/*"])(
    "refuses unsafe mapping %s without changing any local head",
    async (refspec) => {
      await withGitFixture({ bare: true, seed: false }, async (upstream) => {
        await withGitFixture({}, async (fixture) => {
          expect(
            (
              await fixture.run(["remote", "add", "origin", upstream.root], {
                operationClass: "write",
              })
            ).ok,
          ).toBeTrue();
          expect(
            (await fixture.run(["push", "origin", "main"], { operationClass: "network" })).ok,
          ).toBeTrue();
          fixture.writeFile("protected.txt", "local-only commit\n");
          expect((await fixture.commit("Local protected commit")).ok).toBeTrue();
          expect(
            (await fixture.run(["branch", "protected"], { operationClass: "write" })).ok,
          ).toBeTrue();
          expect(
            (
              await fixture.run(["config", "--replace-all", "remote.origin.fetch", refspec], {
                operationClass: "write",
              })
            ).ok,
          ).toBeTrue();
          const before = (
            await fixture.run(["for-each-ref", "--format=%(refname):%(objectname)", "refs/heads"])
          ).stdout;
          const outcome = await executeRemoteFetch(createContext(fixture.client, fixture.root));
          expect(outcome.blockedReason).toBe("unsafe-fetch-refspec");
          expect(outcome.steps).toEqual([]);
          expect(
            (await fixture.run(["for-each-ref", "--format=%(refname):%(objectname)", "refs/heads"]))
              .stdout,
          ).toBe(before);
        });
      });
    },
  );

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

        // A branch never tracked by any local branch must still be discovered.
        expect(
          (await upstream.run(["branch", "newly-discovered", newOid], { operationClass: "write" }))
            .ok,
        ).toBeTrue();
        expect(
          (await fixture.run(["config", "fetch.prune", "true"], { operationClass: "write" })).ok,
        ).toBeTrue();
        expect(
          (
            await fixture.run(["update-ref", "refs/remotes/origin/stale", oldOid], {
              operationClass: "write",
            })
          ).ok,
        ).toBeTrue();
        const localBefore = (
          await fixture.run(["for-each-ref", "--format=%(refname):%(objectname)", "refs/heads"])
        ).stdout;
        const outcome = await executeRemoteFetch(createContext(fixture.client, fixture.root));

        expect(
          (await fixture.run(["rev-parse", "refs/remotes/origin/newly-discovered"])).stdout.trim(),
        ).toBe(newOid);
        expect((await fixture.run(["rev-parse", "refs/remotes/origin/stale"])).stdout.trim()).toBe(
          oldOid,
        );
        expect(
          (await fixture.run(["for-each-ref", "--format=%(refname):%(objectname)", "refs/heads"]))
            .stdout,
        ).toBe(localBefore);
        expect(outcome.steps).toHaveLength(1);
        expect(outcome.steps[0]?.exitCode).toBe(0);
        expect(outcome.steps[0]?.argv).toContain("--no-prune");
        expect(outcome.remoteResults).toEqual([{ remote: "origin", succeeded: true }]);
        expect((await fixture.run(["rev-parse", "refs/remotes/origin/main"])).stdout.trim()).toBe(
          newOid,
        );
      });
    });
  });
});
