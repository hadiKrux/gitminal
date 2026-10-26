import { describe, expect, it } from "bun:test";
import {
  executeBranchCreate,
  executeBranchDelete,
  executeRemoteCreateLocal,
} from "@/domain/commands/commands.branches";
import type {
  CommandFormValues,
  CommandHandlerContext,
  CommandTarget,
} from "@/domain/commands/commands.types";
import { readBranchRisk, resolveBranchMergeTarget } from "@/domain/git/git.branches";
import { readRepositorySnapshot } from "@/domain/repository/repository.read";
import type { BranchRiskRead } from "@/domain/repository/repository.types";
import {
  EMPTY_UPSTREAM_EVIDENCE,
  readUpstreamStatus,
  withAppDeletion,
} from "@/domain/repository/repository.upstream";
import { type GitFixture, isGitAvailable, withGitFixture } from "@/test/git.fixture";

const gitAvailable = isGitAvailable();

/**
 * Builds a handler context bound to one fixture repository.
 *
 * @param fixture - Fixture providing the production client and root.
 * @param commandId - Command under test.
 * @param target - Explicit target captured at dispatch time.
 * @param formValues - Values the owning modal would submit.
 * @returns The handler context with a never-aborted signal.
 */
function createContext(
  fixture: GitFixture,
  commandId: string,
  target: CommandTarget,
  formValues: CommandFormValues,
): CommandHandlerContext {
  return {
    request: { commandId, target, formValues },
    target,
    cwd: fixture.root,
    client: fixture.client,
    signal: new AbortController().signal,
    notifyProgress: () => {},
  };
}

/**
 * Reports whether a ref resolves in the fixture repository.
 *
 * @param fixture - Fixture repository.
 * @param ref - Full ref name.
 * @returns True when `git rev-parse --verify` resolves the ref.
 */
async function refExists(fixture: GitFixture, ref: string): Promise<boolean> {
  return (await fixture.run(["rev-parse", "--verify", "--quiet", ref])).ok;
}

/**
 * Reads the short name of the checked-out branch.
 *
 * @param fixture - Fixture repository.
 * @returns The branch name, or an empty string when HEAD is detached.
 */
async function currentBranch(fixture: GitFixture): Promise<string> {
  return (await fixture.run(["symbolic-ref", "--short", "HEAD"])).stdout.trim();
}

/**
 * Creates the commit whose import would overwrite a local modification.
 *
 * The start point deliberately changes `shared.txt` so checking it out with an uncommitted change to
 * the same file is refused by git.
 *
 * @param fixture - Fixture repository.
 * @returns The oid of the prepared commit.
 */
async function createConflictingCommit(fixture: GitFixture): Promise<string> {
  expect((await fixture.run(["checkout", "-b", "conflict"], { operationClass: "write" })).ok).toBe(
    true,
  );
  fixture.writeFile("shared.txt", "conflict branch\n");
  expect((await fixture.commit("Conflict commit")).ok).toBeTrue();

  const tip = (await fixture.run(["rev-parse", "refs/heads/conflict"])).stdout.trim();

  expect((await fixture.run(["checkout", "main"], { operationClass: "write" })).ok).toBeTrue();

  return tip;
}

/**
 * Adds a bare upstream and pushes the seeded main branch to it.
 *
 * @param fixture - Local fixture repository.
 * @param upstream - Bare fixture acting as the remote.
 */
async function addOrigin(fixture: GitFixture, upstream: GitFixture): Promise<void> {
  expect(
    (await fixture.run(["remote", "add", "origin", upstream.root], { operationClass: "write" })).ok,
  ).toBeTrue();
  expect(
    (await fixture.run(["push", "-u", "origin", "main"], { operationClass: "network" })).ok,
  ).toBeTrue();
}

/**
 * Creates and pushes a feature branch, then returns to main.
 *
 * @param fixture - Local fixture repository.
 * @returns The feature tip oid.
 */
async function pushFeatureBranch(fixture: GitFixture): Promise<string> {
  expect(
    (await fixture.run(["checkout", "-b", "feature"], { operationClass: "write" })).ok,
  ).toBeTrue();
  fixture.writeFile("feature.txt", "feature content\n");
  expect((await fixture.commit("Feature commit")).ok).toBeTrue();
  expect(
    (await fixture.run(["push", "-u", "origin", "feature"], { operationClass: "network" })).ok,
  ).toBeTrue();
  expect((await fixture.run(["checkout", "main"], { operationClass: "write" })).ok).toBeTrue();

  return (await fixture.run(["rev-parse", "refs/heads/feature"])).stdout.trim();
}

/**
 * Builds the delete form values the modal submits for one scope.
 *
 * @param scope - Local-only or local-and-remote.
 * @param force - Force acknowledgement state.
 * @returns The form values.
 */
function deleteValues(scope: "local" | "local-remote", force: boolean): CommandFormValues {
  return { scope, force, remote: "origin", remoteBranch: "feature" };
}

/**
 * Creates a feature branch with a local-only commit and deletes its upstream ref.
 *
 * The local branch keeps its configured upstream after the remote delete, which is exactly the
 * state where a naive merge base would point at a ref that no longer resolves.
 *
 * @param fixture - Local fixture repository.
 * @param upstream - Bare fixture acting as the remote.
 */
async function prepareBranchWithDeletedUpstream(
  fixture: GitFixture,
  upstream: GitFixture,
): Promise<void> {
  await addOrigin(fixture, upstream);
  await pushFeatureBranch(fixture);

  expect((await fixture.run(["checkout", "feature"], { operationClass: "write" })).ok).toBeTrue();
  fixture.writeFile("local-only.txt", "local only\n");
  expect((await fixture.commit("Local only commit")).ok).toBeTrue();
  expect((await fixture.run(["checkout", "main"], { operationClass: "write" })).ok).toBeTrue();
  expect(
    (await fixture.run(["push", "origin", "--delete", "feature"], { operationClass: "network" }))
      .ok,
  ).toBeTrue();
  expect(await refExists(fixture, "refs/remotes/origin/feature")).toBeFalse();
}

/**
 * Reads one branch whose configured upstream ref is gone.
 *
 * @param fixture - Fixture repository prepared by `prepareBranchWithDeletedUpstream`.
 * @returns The resolved risk base and the at-risk read.
 */
async function readBranchWithMissingUpstream(
  fixture: GitFixture,
): Promise<{ readonly base: string; readonly risk: BranchRiskRead }> {
  const signal = new AbortController().signal;
  const snapshot = await readRepositorySnapshot(fixture.client, {
    cwd: fixture.root,
    signal,
    now: () => Date.now(),
    evidence: EMPTY_UPSTREAM_EVIDENCE,
  });
  const branch = snapshot.snapshot?.branches.find((record) => record.name === "feature");

  expect(snapshot.ok).toBeTrue();
  expect(branch?.upstreamRemote).toBe("origin");
  expect(branch?.upstreamBranch).toBe("feature");
  expect(branch?.upstreamStatus).toBe("notFound");

  const base = resolveBranchMergeTarget({
    branch: branch ?? null,
    remoteBranches: snapshot.snapshot?.remoteBranches ?? [],
    fallbackUpstream: snapshot.snapshot?.upstream ?? null,
  });
  const risk = await readBranchRisk(
    fixture.client,
    { cwd: fixture.root, signal },
    { name: "feature", base },
  );

  return { base, risk };
}

describe.skipIf(!gitAvailable)("branch mutations against a real repository", () => {
  it("leaves no branch behind when the atomic create-with-checkout fails", async () => {
    await withGitFixture({}, async (fixture) => {
      fixture.writeFile("shared.txt", "base\n");
      expect((await fixture.commit("Add shared file")).ok).toBeTrue();

      const startPoint = await createConflictingCommit(fixture);

      // The work tree now holds a modification git would overwrite, so `switch -c` must refuse.
      fixture.writeFile("shared.txt", "local change\n");

      const outcome = await executeBranchCreate(
        createContext(
          fixture,
          "branch.create",
          { kind: "none" },
          {
            name: "from-conflict",
            startPoint,
            checkout: true,
          },
        ),
      );

      expect(outcome.steps).toHaveLength(1);
      expect(outcome.steps[0]?.argv).toEqual(["git", "switch", "-c", "from-conflict", startPoint]);
      expect(outcome.steps[0]?.exitCode).not.toBe(0);
      expect(outcome.steps[0]?.stderr).toContain("would be overwritten");
      expect(await refExists(fixture, "refs/heads/from-conflict")).toBeFalse();
      expect(await currentBranch(fixture)).toBe("main");
    });
  });

  it("performs no remote delete when the local delete fails and leaves both branches", async () => {
    await withGitFixture({ bare: true, seed: false }, async (upstream) => {
      await withGitFixture({}, async (fixture) => {
        await addOrigin(fixture, upstream);
        await pushFeatureBranch(fixture);

        // A local-only commit makes the branch unmerged into its upstream, which is exactly the
        // state where `git branch -d` refuses without the force acknowledgement.
        expect(
          (await fixture.run(["checkout", "feature"], { operationClass: "write" })).ok,
        ).toBeTrue();
        fixture.writeFile("local-only.txt", "local only\n");
        expect((await fixture.commit("Local only commit")).ok).toBeTrue();
        expect(
          (await fixture.run(["checkout", "main"], { operationClass: "write" })).ok,
        ).toBeTrue();

        const outcome = await executeBranchDelete(
          createContext(
            fixture,
            "branch.delete",
            { kind: "branch", name: "feature" },
            deleteValues("local-remote", false),
          ),
        );

        expect(outcome.steps).toHaveLength(1);
        expect(outcome.steps[0]?.argv).toEqual(["git", "branch", "-d", "feature"]);
        expect(outcome.steps[0]?.exitCode).not.toBe(0);
        expect(outcome.steps[0]?.stderr).toContain("not fully merged");
        expect(outcome.remoteResults).toBeUndefined();
        expect(await refExists(fixture, "refs/heads/feature")).toBeTrue();
        expect(await refExists(upstream, "refs/heads/feature")).toBeTrue();
      });
    });
  });

  it("reports a partial failure when the local delete succeeds and the remote delete fails", async () => {
    await withGitFixture({ bare: true, seed: false }, async (upstream) => {
      await withGitFixture({}, async (fixture) => {
        await addOrigin(fixture, upstream);
        await pushFeatureBranch(fixture);

        // Keep the configured upstream, which makes the local `-d` valid, but point the remote at a
        // path that is not a repository so the delete half fails after the local branch is gone.
        expect(
          (
            await fixture.run(["remote", "set-url", "origin", fixture.resolvePath("missing.git")], {
              operationClass: "write",
            })
          ).ok,
        ).toBeTrue();

        const outcome = await executeBranchDelete(
          createContext(
            fixture,
            "branch.delete",
            { kind: "branch", name: "feature" },
            deleteValues("local-remote", false),
          ),
        );

        expect(outcome.steps).toHaveLength(2);
        expect(outcome.steps[0]?.exitCode).toBe(0);
        expect(outcome.steps[1]?.argv).toEqual([
          "git",
          "push",
          "--progress",
          "--delete",
          "--",
          "origin",
          "feature",
        ]);
        expect(outcome.steps[1]?.exitCode).not.toBe(0);
        expect(outcome.failed).toBeTrue();
        expect(outcome.remoteResults).toEqual([{ remote: "origin", succeeded: false }]);
        expect(outcome.warnings).toEqual(["remote branch origin/feature was not deleted"]);
        expect(await refExists(fixture, "refs/heads/feature")).toBeFalse();
        expect(await refExists(fixture, "refs/remotes/origin/feature")).toBeTrue();
        expect(await refExists(upstream, "refs/heads/feature")).toBeTrue();
      });
    });
  });

  it("classifies a tracked upstream as deleted after a successful remote delete without a prune", async () => {
    await withGitFixture({ bare: true, seed: false }, async (upstream) => {
      await withGitFixture({}, async (fixture) => {
        await addOrigin(fixture, upstream);
        await pushFeatureBranch(fixture);

        // A second local branch tracks the same remote branch, so it survives the delete and can
        // show the classification the app records.
        expect(
          (await fixture.run(["branch", "feature-copy", "feature"], { operationClass: "write" }))
            .ok,
        ).toBeTrue();
        expect(
          (
            await fixture.run(["branch", "--set-upstream-to", "origin/feature", "feature-copy"], {
              operationClass: "write",
            })
          ).ok,
        ).toBeTrue();

        const outcome = await executeBranchDelete(
          createContext(
            fixture,
            "branch.delete",
            { kind: "branch", name: "feature" },
            deleteValues("local-remote", false),
          ),
        );

        expect(outcome.steps.map((step) => step.exitCode)).toEqual([0, 0]);
        expect(outcome.remoteResults).toEqual([{ remote: "origin", succeeded: true }]);
        expect(await refExists(fixture, "refs/remotes/origin/feature")).toBeFalse();
        expect(await refExists(upstream, "refs/heads/feature")).toBeFalse();

        const signal = new AbortController().signal;
        const absent = await readUpstreamStatus(fixture.client, {
          cwd: fixture.root,
          signal,
          branch: "feature-copy",
          evidence: EMPTY_UPSTREAM_EVIDENCE,
        });

        expect(absent.status).toBe("gone");

        // This is the evidence the app writes after a reported successful remote delete. No prune
        // timestamp is involved.
        const evidence = withAppDeletion(EMPTY_UPSTREAM_EVIDENCE, "origin/feature");

        expect(evidence.prunedRefs).toEqual([]);

        const classified = await readUpstreamStatus(fixture.client, {
          cwd: fixture.root,
          signal,
          branch: "feature-copy",
          evidence,
        });

        expect(classified.status).toBe("deleted-after-app-deletion");

        const snapshot = await readRepositorySnapshot(fixture.client, {
          cwd: fixture.root,
          signal,
          now: () => Date.now(),
          evidence,
        });

        expect(snapshot.ok).toBeTrue();
        expect(
          snapshot.snapshot?.branches.find((branch) => branch.name === "feature-copy")
            ?.upstreamStatus,
        ).toBe("deleted");
      });
    });
  });

  it("leaves no local branch when create-local from a remote ref fails its checkout", async () => {
    await withGitFixture({ bare: true, seed: false }, async (upstream) => {
      await withGitFixture({}, async (fixture) => {
        await addOrigin(fixture, upstream);

        expect(
          (await fixture.run(["checkout", "-b", "other"], { operationClass: "write" })).ok,
        ).toBeTrue();
        fixture.writeFile("shared.txt", "other branch\n");
        expect((await fixture.commit("Other commit")).ok).toBeTrue();
        expect(
          (await fixture.run(["push", "-u", "origin", "other"], { operationClass: "network" })).ok,
        ).toBeTrue();
        expect(
          (await fixture.run(["checkout", "main"], { operationClass: "write" })).ok,
        ).toBeTrue();
        expect(
          (await fixture.run(["branch", "-D", "other"], { operationClass: "write" })).ok,
        ).toBeTrue();

        // The remote-tracking ref is the base, and a local modification to the same file makes the
        // atomic switch refuse.
        fixture.writeFile("shared.txt", "local change\n");

        const outcome = await executeRemoteCreateLocal(
          createContext(
            fixture,
            "remote.createLocal",
            { kind: "remoteBranch", remote: "origin", branch: "other" },
            { name: "from-remote", checkout: true },
          ),
        );

        expect(outcome.steps).toHaveLength(1);
        expect(outcome.steps[0]?.argv).toEqual([
          "git",
          "switch",
          "-c",
          "from-remote",
          "origin/other",
        ]);
        expect(outcome.steps[0]?.exitCode).not.toBe(0);
        expect(outcome.steps[0]?.stderr).toContain("would be overwritten");
        expect(await refExists(fixture, "refs/heads/from-remote")).toBeFalse();
        expect(await currentBranch(fixture)).toBe("main");
        expect(await refExists(fixture, "refs/remotes/origin/other")).toBeTrue();
        expect(await refExists(upstream, "refs/heads/other")).toBeTrue();
      });
    });
  });

  it("uses HEAD and keeps the force path when a configured upstream ref is gone", async () => {
    await withGitFixture({ bare: true, seed: false }, async (upstream) => {
      await withGitFixture({}, async (fixture) => {
        await prepareBranchWithDeletedUpstream(fixture, upstream);

        const { base, risk } = await readBranchWithMissingUpstream(fixture);

        expect(base).toBe("HEAD");
        expect(risk.error).toBeNull();
        expect(risk.merged).toBeFalse();
        expect(risk.hasMore).toBeFalse();
        expect(risk.commits.map((commit) => commit.subject)).toContain("Local only commit");

        const refusal = await fixture.run(["branch", "-d", "feature"], { operationClass: "write" });

        expect(refusal.ok).toBeFalse();
        expect(await refExists(fixture, "refs/heads/feature")).toBeTrue();

        const outcome = await executeBranchDelete(
          createContext(
            fixture,
            "branch.delete",
            { kind: "branch", name: "feature" },
            deleteValues("local", true),
          ),
        );

        expect(outcome.steps).toHaveLength(1);
        expect(outcome.steps[0]?.argv).toEqual(["git", "branch", "-D", "feature"]);
        expect(outcome.steps[0]?.exitCode).toBe(0);
        expect(await refExists(fixture, "refs/heads/feature")).toBeFalse();
      });
    });
  });
});
