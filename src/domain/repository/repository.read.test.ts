import { describe, expect, it } from "bun:test";
import { buildListLocalBranchesArgs } from "@/domain/git/git.branches";
import { buildListRemoteBranchesArgs } from "@/domain/git/git.remote-branches";
import { buildListStashesArgs } from "@/domain/git/git.stashes";
import { STATUS_ARGS } from "@/domain/git/git.status";
import type { GitClient, GitInvocationResult } from "@/domain/git/git.types";
import { buildListWorktreesArgs } from "@/domain/git/git.worktrees";
import { readRepositorySnapshot } from "@/domain/repository/repository.read";
import { EMPTY_UPSTREAM_EVIDENCE, withAppDeletion } from "@/domain/repository/repository.upstream";
import { createFakeGitClient, fakeGitResult } from "@/test/git.fake";

/** Committer date used by the recorded branch fixtures. */
const BRANCH_DATE = "2026-01-02T03:04:05+00:00";

/** Joined argv of the batched local branch read. */
const BRANCH_READ_KEY = buildListLocalBranchesArgs().join(" ");

/** Joined argv of the stash list read. */
const STASH_READ_KEY = buildListStashesArgs().join(" ");

/** Joined argv of the worktree list read. */
const WORKTREES_READ_KEY = buildListWorktreesArgs().join(" ");

/** Joined argv of the remote-tracking branch read. */
const REMOTE_BRANCH_READ_KEY = buildListRemoteBranchesArgs().join(" ");

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

  it("resolves whether any local branch has an upstream from the batched branch read", async () => {
    const fake = createFakeGitClient();

    const withUpstream = await readRepositorySnapshot(fake.client, readOptions());

    expect(withUpstream.signals.hasUpstreamBranches).toBeTrue();

    const withoutUpstream = await readRepositorySnapshot(
      overrideCommand(
        fake.client,
        BRANCH_READ_KEY,
        fakeGitResult(`feature\0def456\0*\0${BRANCH_DATE}\0\0\0\n`),
      ),
      readOptions(),
    );

    expect(withoutUpstream.signals.hasUpstreamBranches).toBeFalse();
  });

  it("reads local and remote-tracking branches into one snapshot", async () => {
    const fake = createFakeGitClient();

    const result = await readRepositorySnapshot(fake.client, readOptions());
    const snapshot = result.snapshot;

    expect(snapshot?.branches.map((branch) => branch.name)).toEqual(["main", "feature"]);
    expect(snapshot?.branches[0]?.upstreamStatus).toBe("tracked");
    expect(snapshot?.branches[0]?.ahead).toBe(2);
    expect(snapshot?.branches[0]?.behind).toBe(1);
    expect(snapshot?.branches[0]?.worktreePath).toBeNull();
    expect(snapshot?.branches[1]?.upstreamStatus).toBe("none");
    expect(snapshot?.branches[1]?.worktreePath).toBe("/repo-feature");
    expect(snapshot?.branches[0]).not.toHaveProperty("merged");
    expect(snapshot?.remoteBranches.map((branch) => `${branch.remote}/${branch.branch}`)).toEqual([
      "origin/main",
    ]);
  });

  it("reads the HEAD commit subject for the stash prefill", async () => {
    const fake = createFakeGitClient();

    const result = await readRepositorySnapshot(fake.client, readOptions());

    expect(result.snapshot?.headSubject).toBe("initial commit");
  });

  it("leaves the HEAD subject null when the subject read fails", async () => {
    const fake = createFakeGitClient();
    const client = overrideCommand(
      fake.client,
      "log -1 --format=%s",
      fakeGitResult("", false, "fatal: bad revision"),
    );

    const result = await readRepositorySnapshot(client, readOptions());

    expect(result.ok).toBeTrue();
    expect(result.snapshot?.headSubject).toBeNull();
    expect(result.snapshot?.headOid).toBe("abc123");
  });

  it("does not read merge state while listing branches", async () => {
    const fake = createFakeGitClient();
    let mergedReads = 0;
    const client: GitClient = {
      gitPath: fake.client.gitPath,
      invoke: async (options) => {
        if (options.args.some((arg) => arg.startsWith("--merged="))) {
          mergedReads += 1;
        }

        return await fake.client.invoke(options);
      },
    };

    const result = await readRepositorySnapshot(client, readOptions());

    expect(result.ok).toBeTrue();
    expect(mergedReads).toBe(0);
  });

  it("reads worktree dirty state with bounded concurrency and treats unknown as clean", async () => {
    const fake = createFakeGitClient();
    const linkedPaths = ["/repo-a", "/repo-b", "/repo-c", "/repo-d", "/repo-e"];
    const worktreesOutput = [
      "worktree /repo",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      ...linkedPaths.flatMap((path, index) => [
        `worktree ${path}`,
        `HEAD tip${index}`,
        `branch refs/heads/b${index}`,
        "",
      ]),
      "worktree /repo-prunable",
      "HEAD prunable",
      "branch refs/heads/prunable",
      "prunable missing",
      "",
    ].join("\n");
    const failPath = "/repo-c";
    let inFlight = 0;
    let maxInFlight = 0;
    const client: GitClient = {
      gitPath: fake.client.gitPath,
      invoke: async (options) => {
        const key = options.args.join(" ");

        if (key === WORKTREES_READ_KEY) {
          return fakeGitResult(worktreesOutput);
        }

        if (key === STATUS_ARGS.join(" ") && options.cwd !== "/repo") {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);

          await new Promise((resolve) => setTimeout(resolve, 5));

          inFlight -= 1;

          return options.cwd === failPath
            ? fakeGitResult("", false, "fatal: cannot read worktree")
            : fakeGitResult("? dirty.txt\0");
        }

        return await fake.client.invoke(options);
      },
    };

    const result = await readRepositorySnapshot(client, readOptions());
    const dirtyByPath = new Map(
      (result.snapshot?.worktrees ?? []).map((worktree) => [worktree.path, worktree.dirty]),
    );

    expect(result.ok).toBeTrue();
    expect(maxInFlight).toBe(4);
    expect(dirtyByPath.get("/repo")).toBeFalse();
    expect(dirtyByPath.get("/repo-c")).toBeFalse();
    expect(dirtyByPath.get("/repo-prunable")).toBeFalse();

    for (const path of ["/repo-a", "/repo-b", "/repo-d", "/repo-e"]) {
      expect(dirtyByPath.get(path)).toBeTrue();
    }
  });

  it("reads tags, stashes, worktrees, and the current worktree", async () => {
    const fake = createFakeGitClient();

    const result = await readRepositorySnapshot(fake.client, readOptions());
    const snapshot = result.snapshot;

    expect(snapshot?.tags).toEqual([
      { name: "v1.0.0", objectType: "commit", targetOid: "abc123", subject: "initial commit" },
    ]);
    expect(snapshot?.stashes[0]?.objectName).toBe("aaa111");
    expect(snapshot?.stashes[0]?.sourceBranch).toBe("main");
    expect(snapshot?.stashes[0]?.committedAt).toBe(1_700_000_000);
    expect(snapshot?.worktrees).toHaveLength(2);
    expect(snapshot?.worktrees.map((worktree) => worktree.current)).toEqual([true, false]);
    expect(snapshot?.currentWorktreePath).toBe("/repo");
  });

  it("classifies a branch whose upstream an app deletion removed", async () => {
    const fake = createFakeGitClient();
    const topic = overrideCommand(
      fake.client,
      BRANCH_READ_KEY,
      fakeGitResult(
        [
          `main\0abc123\0*\0${BRANCH_DATE}\0origin\0refs/heads/main\0[ahead 2, behind 1]`,
          `topic\0def456\0 \0${BRANCH_DATE}\0origin\0refs/heads/topic\0`,
        ].join("\n"),
      ),
    );

    const result = await readRepositorySnapshot(topic, {
      ...readOptions(),
      evidence: withAppDeletion(EMPTY_UPSTREAM_EVIDENCE, "origin/topic"),
    });

    expect(result.snapshot?.branches[1]?.upstreamStatus).toBe("deleted");
  });

  it("keeps the snapshot and reports only the list that failed", async () => {
    const fake = createFakeGitClient();
    const client = overrideCommand(
      fake.client,
      STASH_READ_KEY,
      fakeGitResult("", false, "fatal: unable to read logs"),
    );

    const result = await readRepositorySnapshot(client, readOptions());

    expect(result.ok).toBeTrue();
    expect(result.snapshot?.stashes).toEqual([]);
    expect(result.snapshot?.branches).toHaveLength(2);
    expect(result.snapshot?.tags).toHaveLength(1);
    expect(result.listFailures.stashes).toContain("unable to read logs");
    expect(result.listFailures.branches).toBeUndefined();
    expect(result.listFailures.tags).toBeUndefined();
    expect(result.error).toBeNull();
  });

  it("reports every failed optional list in one read", async () => {
    const fake = createFakeGitClient();
    const withStashes = overrideCommand(
      fake.client,
      STASH_READ_KEY,
      fakeGitResult("", false, "fatal: unable to read logs"),
    );
    const client = overrideCommand(
      withStashes,
      WORKTREES_READ_KEY,
      fakeGitResult("", false, "fatal: cannot read worktrees"),
    );

    const result = await readRepositorySnapshot(client, readOptions());

    expect(result.ok).toBeTrue();
    expect(Object.keys(result.listFailures).sort()).toEqual(["stashes", "worktrees"]);
    expect(result.snapshot?.stashes).toEqual([]);
    expect(result.snapshot?.worktrees).toEqual([]);
    expect(result.snapshot?.currentWorktreePath).toBeNull();
    expect(result.snapshot?.branches[1]?.worktreePath).toBeNull();
  });

  it("keeps parsed upstream states when the remote-branch read fails", async () => {
    const fake = createFakeGitClient();
    const client = overrideCommand(
      fake.client,
      REMOTE_BRANCH_READ_KEY,
      fakeGitResult("", false, "fatal: unable to read refs"),
    );

    const result = await readRepositorySnapshot(client, readOptions());

    expect(result.ok).toBeTrue();
    expect(result.listFailures.remoteBranches).toContain("unable to read refs");
    expect(result.snapshot?.remoteBranches).toEqual([]);
    // A failed remote read is unknown evidence, never proof that the upstream is missing.
    expect(result.snapshot?.branches[0]?.upstreamStatus).toBe("unknown");
    expect(result.snapshot?.branches[1]?.upstreamStatus).toBe("none");
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
