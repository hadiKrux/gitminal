import { describe, expect, it } from "bun:test";
import { groupByRemote, readRemoteBranches } from "@/domain/git/git.remote-branches";
import { readRemotes } from "@/domain/git/git.remotes";
import { selectRemoteFreshness } from "@/domain/repository/repository.selectors";
import type { RemoteCheckRecord } from "@/domain/repository/repository.types";
import { confirmRemoteBranch } from "@/domain/repository/repository.upstream";
import { type GitFixture, isGitAvailable, withGitFixture } from "@/test/git.fixture";

const gitAvailable = isGitAvailable();

/** Descriptor the app uses to check the pushed main branch. */
const MAIN_DESCRIPTOR = Object.freeze({ ref: "origin/main", remote: "origin", branch: "main" });

/**
 * Applies the app's success gate to one remote check.
 *
 * `RepositoryProvider.recordRemoteCheck` returns without writing when the attempt failed and
 * otherwise writes the attempt clock as `lastSuccessfulCheckAt`. The domain layer cannot import the
 * provider, so the rule is restated here; the observable result is still classified by the
 * production `selectRemoteFreshness`.
 *
 * @param record - Previous per-remote record.
 * @param succeeded - Whether the remote read succeeded.
 * @param at - Clock value of the attempt.
 * @returns The updated record on success, or the untouched record on failure.
 */
function recordCheckWhenSucceeded(
  record: RemoteCheckRecord,
  succeeded: boolean,
  at: number,
): RemoteCheckRecord {
  return succeeded ? { ...record, lastSuccessfulCheckAt: at } : record;
}

/**
 * Adds a bare upstream, pushes main, and returns the production read options.
 *
 * @param fixture - Local fixture repository.
 * @param upstream - Bare fixture acting as the remote.
 * @returns The read options for the fixture repository.
 */
async function addOriginAndPush(
  fixture: GitFixture,
  upstream: GitFixture,
): Promise<{ readonly cwd: string; readonly signal: AbortSignal }> {
  expect(
    (await fixture.run(["remote", "add", "origin", upstream.root], { operationClass: "write" })).ok,
  ).toBeTrue();
  expect(
    (await fixture.run(["push", "-u", "origin", "main"], { operationClass: "network" })).ok,
  ).toBeTrue();

  return { cwd: fixture.root, signal: new AbortController().signal };
}

describe.skipIf(!gitAvailable)("remote branches against a real repository", () => {
  it("reads and groups a real for-each-ref refs/remotes fixture", async () => {
    await withGitFixture({ bare: true, seed: false }, async (origin) => {
      await withGitFixture({ bare: true, seed: false }, async (team) => {
        await withGitFixture({}, async (fixture) => {
          expect(
            (
              await fixture.run(["remote", "add", "origin", origin.root], {
                operationClass: "write",
              })
            ).ok,
          ).toBeTrue();
          expect(
            (await fixture.run(["push", "-u", "origin", "main"], { operationClass: "network" })).ok,
          ).toBeTrue();
          expect(
            (await fixture.run(["checkout", "-b", "feature/nested"], { operationClass: "write" }))
              .ok,
          ).toBeTrue();
          fixture.writeFile("nested.txt", "nested content\n");
          expect((await fixture.commit("Nested feature commit")).ok).toBeTrue();
          expect(
            (
              await fixture.run(["push", "-u", "origin", "feature/nested"], {
                operationClass: "network",
              })
            ).ok,
          ).toBeTrue();
          expect(
            (await fixture.run(["checkout", "main"], { operationClass: "write" })).ok,
          ).toBeTrue();

          // A slash-named remote and its shorter prefix remote are both configured, so only the
          // longest-first attribution can keep the tracking refs apart.
          expect(
            (
              await fixture.run(["remote", "add", "team/upstream", team.root], {
                operationClass: "write",
              })
            ).ok,
          ).toBeTrue();
          // Intentionally construct a legacy overlapping configuration without remote add's
          // newer subset-name validation; attribution must support already-configured remotes.
          for (const [key, value] of [
            ["remote.team.url", team.root],
            ["remote.team.fetch", "+refs/heads/*:refs/remotes/team/*"],
          ] as const) {
            expect(
              (await fixture.run(["config", key, value], { operationClass: "write" })).ok,
            ).toBeTrue();
          }
          expect(
            (
              await fixture.run(["push", "team/upstream", "refs/heads/main:refs/heads/main"], {
                operationClass: "network",
              })
            ).ok,
          ).toBeTrue();
          expect(
            (
              await fixture.run(["fetch", "--prune", "--", "team/upstream"], {
                operationClass: "network",
              })
            ).ok,
          ).toBeTrue();
          expect(
            (
              await fixture.run(["fetch", "--prune", "--", "origin"], {
                operationClass: "network",
              })
            ).ok,
          ).toBeTrue();

          // git only creates this symbolic ref for clones, so model it explicitly to prove the
          // parser drops origin/HEAD from a real ref listing.
          expect(
            (
              await fixture.run(
                ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"],
                { operationClass: "write" },
              )
            ).ok,
          ).toBeTrue();

          const options = { cwd: fixture.root, signal: new AbortController().signal };
          const remotes = await readRemotes(fixture.client, options);

          expect(remotes.ok).toBeTrue();
          expect(remotes.remotes.map((remote) => remote.name).sort()).toEqual([
            "origin",
            "team",
            "team/upstream",
          ]);

          const read = await readRemoteBranches(fixture.client, options, remotes.remotes);

          expect(read.ok).toBeTrue();
          expect(read.remoteBranches.map((record) => record.ref)).not.toContain(
            "refs/remotes/origin/HEAD",
          );

          const groups = groupByRemote(read.remoteBranches);

          expect(groups.map((group) => group.remote)).toEqual(["origin", "team/upstream"]);
          expect(groups[0]?.branches.map((record) => record.branch)).toEqual([
            "feature/nested",
            "main",
          ]);
          expect(groups[1]?.branches.map((record) => record.branch)).toEqual(["main"]);

          const nested = groups[0]?.branches[0];

          expect(nested?.ref).toBe("refs/remotes/origin/feature/nested");
          expect(nested?.tipOid).toMatch(/^[0-9a-f]{40,64}$/);
          expect(nested?.committerDate).not.toBeNull();
          expect(nested?.subject).toBe("Nested feature commit");
          expect(groups[1]?.branches[0]?.remote).toBe("team/upstream");
        });
      });
    });
  });

  it("records a successful remote read as a fresh per-remote check", async () => {
    await withGitFixture({ bare: true, seed: false }, async (upstream) => {
      await withGitFixture({}, async (fixture) => {
        const options = await addOriginAndPush(fixture, upstream);
        const remotes = await readRemotes(fixture.client, options);

        expect(remotes.ok).toBeTrue();

        const previous: RemoteCheckRecord = {
          lastSuccessfulCheckAt: null,
          lastSuccessfulFetchAt: null,
        };
        const read = await readRemoteBranches(fixture.client, options, remotes.remotes);

        expect(read.ok).toBeTrue();
        expect(read.remoteBranches).toHaveLength(1);

        const check = await confirmRemoteBranch(fixture.client, options, MAIN_DESCRIPTOR);

        expect(check).toBe("present");
        expect(selectRemoteFreshness(previous, 6_000, 60_000)).toBe("unknown");

        const recorded = recordCheckWhenSucceeded(previous, read.ok && check === "present", 5_000);

        expect(recorded.lastSuccessfulCheckAt).toBe(5_000);
        expect(recorded.lastSuccessfulFetchAt).toBeNull();
        expect(selectRemoteFreshness(recorded, 6_000, 60_000)).toBe("fresh");
      });
    });
  });

  it("leaves the per-remote timestamp and refs unchanged when ls-remote fails", async () => {
    await withGitFixture({ bare: true, seed: false }, async (upstream) => {
      await withGitFixture({}, async (fixture) => {
        const options = await addOriginAndPush(fixture, upstream);
        const remotes = await readRemotes(fixture.client, options);

        expect(remotes.ok).toBeTrue();

        const before = await readRemoteBranches(fixture.client, options, remotes.remotes);

        expect(before.ok).toBeTrue();
        expect(before.remoteBranches).toHaveLength(1);

        const knownRefs = before.remoteBranches.map((record) => ({
          ref: record.ref,
          tipOid: record.tipOid,
        }));
        const established: RemoteCheckRecord = {
          lastSuccessfulCheckAt: 1_000,
          lastSuccessfulFetchAt: null,
        };

        // An unreachable remote makes the real `ls-remote` exit non-zero, which is the failed check
        // the classification must report as unknown rather than absent.
        expect(
          (
            await fixture.run(["remote", "set-url", "origin", fixture.resolvePath("missing.git")], {
              operationClass: "write",
            })
          ).ok,
        ).toBeTrue();
        expect((await fixture.run(["ls-remote", "--heads", "--", "origin"])).ok).toBeFalse();

        const check = await confirmRemoteBranch(fixture.client, options, MAIN_DESCRIPTOR);

        expect(check).toBe("unknown");

        const recorded = recordCheckWhenSucceeded(established, check === "present", 9_000);

        expect(recorded).toEqual(established);
        expect(recorded.lastSuccessfulCheckAt).toBe(1_000);
        expect(selectRemoteFreshness(recorded, 2_000, 60_000)).toBe("fresh");

        const after = await readRemoteBranches(fixture.client, options, remotes.remotes);

        expect(after.ok).toBeTrue();
        expect(
          after.remoteBranches.map((record) => ({ ref: record.ref, tipOid: record.tipOid })),
        ).toEqual(knownRefs);
      });
    });
  });
});
