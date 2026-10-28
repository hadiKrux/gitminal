import { describe, expect, it } from "bun:test";
import { executeRemoteFetchPrune } from "@/domain/commands/commands.prune";
import type { CommandHandlerContext } from "@/domain/commands/commands.types";
import type { GitClient } from "@/domain/git/git.types";
import { isGitAvailable, withGitFixture } from "@/test/git.fixture";

const gitAvailable = isGitAvailable();

/**
 * Builds a Fetch --prune handler context bound to one fixture repository.
 *
 * The request passes an explicit `local` fetch scope so these tests exercise the scope gate that
 * enables the remote-wide prune instead of relying on the absent-value fallback.
 *
 * @param client - Production client from the fixture.
 * @param cwd - Repository root.
 * @returns The handler context with a never-aborted signal.
 */
function createFetchPruneContext(client: GitClient, cwd: string): CommandHandlerContext {
  return {
    request: {
      commandId: "remote.fetchPrune",
      target: { kind: "none" },
      formValues: { fetchScope: "local" },
    },
    target: { kind: "none" },
    cwd,
    client,
    signal: new AbortController().signal,
    notifyProgress: () => {},
  };
}

describe.skipIf(!gitAvailable)("remote.fetchPrune against a real repository", () => {
  it("removes a stale tracking ref that no local branch tracks", async () => {
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
          (
            await fixture.run(["push", "-u", "origin", "refs/heads/main:refs/heads/main"], {
              operationClass: "network",
            })
          ).ok,
        ).toBeTrue();

        const tip = (await fixture.run(["rev-parse", "refs/heads/main"])).stdout.trim();

        // The remote never advertised this branch, and no local branch tracks it, which is the row
        // that survived every upstream-scoped prune before this change.
        expect(
          (
            await fixture.run(["update-ref", "refs/remotes/origin/gone", tip], {
              operationClass: "write",
            })
          ).ok,
        ).toBeTrue();

        const outcome = await executeRemoteFetchPrune(
          createFetchPruneContext(fixture.client, fixture.root),
        );

        expect(outcome.steps.at(-1)?.argv).toEqual(["git", "remote", "prune", "--", "origin"]);
        expect(outcome.prunedUpstreamRefs).toEqual([]);
        expect(outcome.failed).toBeUndefined();
        expect(
          (await fixture.run(["rev-parse", "--verify", "refs/remotes/origin/gone"])).ok,
        ).toBeFalse();
        expect(
          (await fixture.run(["rev-parse", "--verify", "refs/remotes/origin/main"])).ok,
        ).toBeTrue();
      });
    });
  });

  it("keeps a tracking ref whose remote source still exists outside refs/heads", async () => {
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
          (
            await fixture.run(["push", "-u", "origin", "refs/heads/main:refs/heads/main"], {
              operationClass: "network",
            })
          ).ok,
        ).toBeTrue();

        // A pull-request ref is a live remote ref that no head advertises. A heads-only diff would
        // delete its tracking ref; git's own prune compares the configured refspecs instead.
        expect(
          (
            await fixture.run(["push", "origin", "refs/heads/main:refs/pull/1/head"], {
              operationClass: "network",
            })
          ).ok,
        ).toBeTrue();
        expect(
          (
            await fixture.run(
              [
                "config",
                "--add",
                "remote.origin.fetch",
                "+refs/pull/*/head:refs/remotes/origin/pr/*",
              ],
              { operationClass: "write" },
            )
          ).ok,
        ).toBeTrue();
        expect(
          (
            await fixture.run(["fetch", "origin", "refs/pull/1/head:refs/remotes/origin/pr/1"], {
              operationClass: "network",
            })
          ).ok,
        ).toBeTrue();

        const tip = (await fixture.run(["rev-parse", "refs/heads/main"])).stdout.trim();
        expect(
          (
            await fixture.run(["update-ref", "refs/remotes/origin/gone", tip], {
              operationClass: "write",
            })
          ).ok,
        ).toBeTrue();

        expect(
          (await executeRemoteFetchPrune(createFetchPruneContext(fixture.client, fixture.root)))
            .failed,
        ).toBeUndefined();

        expect(
          (await fixture.run(["rev-parse", "--verify", "refs/remotes/origin/gone"])).ok,
        ).toBeFalse();
        expect(
          (await fixture.run(["rev-parse", "--verify", "refs/remotes/origin/pr/1"])).ok,
        ).toBeTrue();
      });
    });
  });

  it("deletes a tracking ref the prune already removed without failing the delete", async () => {
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
          (
            await fixture.run(["push", "-u", "origin", "refs/heads/main:refs/heads/main"], {
              operationClass: "network",
            })
          ).ok,
        ).toBeTrue();
        expect(
          (await fixture.run(["checkout", "-b", "feature"], { operationClass: "write" })).ok,
        ).toBeTrue();
        expect(
          (
            await fixture.run(["push", "-u", "origin", "refs/heads/feature:refs/heads/feature"], {
              operationClass: "network",
            })
          ).ok,
        ).toBeTrue();
        expect(
          (
            await fixture.run(["branch", "--set-upstream-to", "origin/feature", "feature"], {
              operationClass: "write",
            })
          ).ok,
        ).toBeTrue();
        expect(
          (await fixture.run(["checkout", "main"], { operationClass: "write" })).ok,
        ).toBeTrue();

        // Deleting the upstream head leaves origin/feature as a stale in-scope upstream, so the plan
        // is non-empty and the run reaches the explicit delete after the remote-wide prune.
        expect(
          (
            await upstream.run(["update-ref", "-d", "refs/heads/feature"], {
              operationClass: "write",
            })
          ).ok,
        ).toBeTrue();

        const outcome = await executeRemoteFetchPrune(
          createFetchPruneContext(fixture.client, fixture.root),
        );
        const pruneStep = outcome.steps.find(
          (step) => step.argv.join(" ") === "git remote prune -- origin",
        );
        const deleteStep = outcome.steps.find(
          (step) => step.argv.join(" ") === "git update-ref -d -- refs/remotes/origin/feature",
        );

        expect(pruneStep?.exitCode).toBe(0);
        expect(deleteStep?.exitCode).toBe(0);

        // Pin the order the case exists to prove: a flipped order would delete the ref explicitly
        // and then prune a ref that is already gone, so both exit codes would still read 0.
        const argvs = outcome.steps.map((step) => step.argv.join(" "));
        expect(argvs.indexOf("git remote prune -- origin")).toBeLessThan(
          argvs.indexOf("git update-ref -d -- refs/remotes/origin/feature"),
        );

        expect(outcome.prunedUpstreamRefs).toEqual(["origin/feature"]);
        expect(outcome.failed).toBeUndefined();
        expect(
          (await fixture.run(["rev-parse", "--verify", "refs/remotes/origin/feature"])).ok,
        ).toBeFalse();
      });
    });
  });
});
