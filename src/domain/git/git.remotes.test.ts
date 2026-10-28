import { describe, expect, it } from "bun:test";
import {
  buildDeleteTrackingRefArgs,
  buildFetchTrackingRefArgs,
  buildLsRemoteHeadsArgs,
  buildPullArgs,
  buildPushArgs,
  buildRemotePruneArgs,
  buildUpstreamGroupsArgs,
  isSafeGitName,
  isTruncatedOutput,
  parseLsRemoteHeads,
  parseRemoteVerbose,
  planPruneDeletions,
  readRemotes,
  readUpstreamGroups,
} from "@/domain/git/git.remotes";
import type { GitClient, GitInvocationResult } from "@/domain/git/git.types";
import type { UpstreamDescriptor } from "@/domain/repository/repository.types";

/**
 * Builds an invocation result.
 *
 * @param stdout - Captured output.
 * @param ok - Whether git exited cleanly.
 * @returns The synthetic result.
 */
function result(stdout: string, ok: boolean = true): GitInvocationResult {
  return {
    argv: ["git"],
    cwd: "/repo",
    exitCode: ok ? 0 : 1,
    terminationSignal: null,
    stdout,
    stderr: ok ? "" : "fatal: nope",
    durationMs: 1,
    cancelled: false,
    timedOut: false,
    timedOutAfterMs: null,
    spawnError: null,
    ok,
  };
}

describe("parseRemoteVerbose", () => {
  it("reads fetch and push URLs", () => {
    const remotes = parseRemoteVerbose(
      [
        "origin\thttps://example.com/repo.git (fetch)",
        "origin\tgit@example.com:repo.git (push)",
        "",
      ].join("\n"),
    );

    expect(remotes).toEqual([
      {
        name: "origin",
        fetchUrl: "https://example.com/repo.git",
        pushUrl: "git@example.com:repo.git",
      },
    ]);
  });

  it("reports a null push URL when it matches the fetch URL", () => {
    const remotes = parseRemoteVerbose(
      [
        "origin\thttps://example.com/repo.git (fetch)",
        "origin\thttps://example.com/repo.git (push)",
      ].join("\n"),
    );

    expect(remotes[0]?.pushUrl).toBeNull();
  });

  it("keeps multiple remotes in first-seen order", () => {
    const remotes = parseRemoteVerbose(
      [
        "upstream\thttps://example.com/upstream.git (fetch)",
        "upstream\thttps://example.com/upstream.git (push)",
        "origin\thttps://example.com/origin.git (fetch)",
        "origin\thttps://example.com/origin.git (push)",
      ].join("\n"),
    );

    expect(remotes.map((remote) => remote.name)).toEqual(["upstream", "origin"]);
  });

  it("ignores malformed lines", () => {
    expect(parseRemoteVerbose("origin without marker\n\n")).toEqual([]);
  });
});

describe("readRemotes", () => {
  it("runs git remote -v and parses the result", async () => {
    let args: readonly string[] = [];
    const client: GitClient = {
      gitPath: "git",
      invoke: async (options) => {
        args = options.args;

        return result("origin\thttps://example.com/repo.git (fetch)\n");
      },
    };

    const remotes = await readRemotes(client, {
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(args).toEqual(["remote", "-v"]);
    expect(remotes.ok).toBeTrue();
    expect(remotes.remotes).toHaveLength(1);
  });

  it("returns an empty list for a repository without remotes", async () => {
    const client: GitClient = {
      gitPath: "git",
      invoke: async () => result(""),
    };

    const remotes = await readRemotes(client, {
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(remotes).toEqual({ ok: true, remotes: [], failure: null });
  });

  it("returns a classified failure when the remote output is truncated", async () => {
    const client: GitClient = {
      gitPath: "git",
      invoke: async () => ({
        ...result("origin\thttps://example.com/repo.git (fetch)\n"),
        stdoutTruncated: true,
      }),
    };

    const remotes = await readRemotes(client, {
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(remotes.ok).toBeFalse();
    expect(remotes.remotes).toEqual([]);
    expect(remotes.failure?.message).toBe("git remote -v output was truncated");
  });

  it("returns a classified failure", async () => {
    const client: GitClient = {
      gitPath: "git",
      invoke: async () => result("", false),
    };

    const remotes = await readRemotes(client, {
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(remotes.ok).toBeFalse();
    expect(remotes.failure?.kind).toBe("unknown");
  });
});

describe("pull and push planning", () => {
  const upstream: UpstreamDescriptor = { ref: "origin/main", remote: "origin", branch: "main" };

  it("builds a pull with progress and no editor", () => {
    expect(buildPullArgs()).toEqual(["pull", "--progress", "--no-edit"]);
  });

  it("pushes the current branch to its configured upstream with an explicit refspec", () => {
    expect(buildPushArgs({ mode: "push", branch: "main", upstream, remotes: ["origin"] })).toEqual({
      ok: true,
      args: ["push", "--progress", "--", "origin", "refs/heads/main:refs/heads/main"],
    });
  });

  it("adds the correct force flag for each force variant", () => {
    expect(
      buildPushArgs({ mode: "forceSafe", branch: "main", upstream, remotes: ["origin"] }),
    ).toEqual({
      ok: true,
      args: [
        "push",
        "--progress",
        "--force-with-lease",
        "--",
        "origin",
        "refs/heads/main:refs/heads/main",
      ],
    });
    expect(
      buildPushArgs({ mode: "forceOverwrite", branch: "main", upstream, remotes: ["origin"] }),
    ).toEqual({
      ok: true,
      args: ["push", "--progress", "--force", "--", "origin", "refs/heads/main:refs/heads/main"],
    });
  });

  it("adds --no-verify when an upstream exists", () => {
    expect(
      buildPushArgs({ mode: "noVerify", branch: "main", upstream, remotes: ["origin"] }),
    ).toEqual({
      ok: true,
      args: [
        "push",
        "--progress",
        "--no-verify",
        "--",
        "origin",
        "refs/heads/main:refs/heads/main",
      ],
    });
  });

  it("pushes to a differently named upstream branch instead of the local branch name", () => {
    const renamed: UpstreamDescriptor = {
      ref: "origin/remote-main",
      remote: "origin",
      branch: "remote-main",
    };

    expect(
      buildPushArgs({ mode: "push", branch: "local-main", upstream: renamed, remotes: ["origin"] }),
    ).toEqual({
      ok: true,
      args: ["push", "--progress", "--", "origin", "refs/heads/local-main:refs/heads/remote-main"],
    });
  });

  it("creates origin/<branch> and sets the upstream when none is configured", () => {
    expect(
      buildPushArgs({
        mode: "push",
        branch: "feature/AB-1231",
        upstream: null,
        remotes: ["origin"],
      }),
    ).toEqual({
      ok: true,
      args: [
        "push",
        "--progress",
        "--set-upstream",
        "origin",
        "refs/heads/feature/AB-1231:refs/heads/feature/AB-1231",
      ],
    });
  });

  it("keeps --no-verify on the auto-create path", () => {
    expect(
      buildPushArgs({
        mode: "noVerify",
        branch: "feature/AB-1231",
        upstream: null,
        remotes: ["origin"],
      }),
    ).toEqual({
      ok: true,
      args: [
        "push",
        "--progress",
        "--no-verify",
        "--set-upstream",
        "origin",
        "refs/heads/feature/AB-1231:refs/heads/feature/AB-1231",
      ],
    });
  });

  it("rejects an unsafe remote or branch instead of planning an option-like argv", () => {
    expect(
      buildPushArgs({ mode: "push", branch: "-oops", upstream: null, remotes: ["origin"] }),
    ).toEqual({ ok: false, error: 'invalid branch name "-oops"' });
    expect(
      buildPushArgs({
        mode: "push",
        branch: "main",
        upstream: { ref: "-oops/main", remote: "-oops", branch: "main" },
        remotes: ["origin"],
      }),
    ).toEqual({ ok: false, error: 'invalid upstream "-oops/main"' });
  });

  it("lists the configured remotes when origin is absent", () => {
    expect(
      buildPushArgs({
        mode: "push",
        branch: "main",
        upstream: null,
        remotes: ["upstream", "fork"],
      }),
    ).toEqual({
      ok: false,
      error: "No origin remote. Configured remotes: upstream, fork.",
    });
    expect(buildPushArgs({ mode: "push", branch: "main", upstream: null, remotes: [] })).toEqual({
      ok: false,
      error: "No origin remote. Configured remotes: none.",
    });
  });

  it("refuses a force push without an upstream", () => {
    expect(
      buildPushArgs({ mode: "forceSafe", branch: "main", upstream: null, remotes: ["origin"] }),
    ).toEqual({ ok: false, error: "no upstream; use Push to create it first." });
    expect(
      buildPushArgs({
        mode: "forceOverwrite",
        branch: "main",
        upstream: null,
        remotes: ["origin"],
      }),
    ).toEqual({ ok: false, error: "no upstream; use Push to create it first." });
  });
});

describe("argument hardening and truncation", () => {
  it("accepts normal remotes and refs and rejects unsafe values", () => {
    expect(isSafeGitName("origin")).toBeTrue();
    expect(isSafeGitName("feature/AB-1231")).toBeTrue();
    expect(isSafeGitName("origin/feature-x")).toBeTrue();
    expect(isSafeGitName("a/b")).toBeTrue();
    expect(isSafeGitName("-oops")).toBeFalse();
    expect(isSafeGitName("bad name")).toBeFalse();
    expect(isSafeGitName("bad..name")).toBeFalse();
    expect(isSafeGitName("")).toBeFalse();
  });

  it("reports a truncated stream as incomplete evidence", () => {
    expect(isTruncatedOutput(result(""))).toBeFalse();
    expect(isTruncatedOutput({ ...result(""), stdoutTruncated: true })).toBeTrue();
    expect(isTruncatedOutput({ ...result(""), stderrTruncated: true })).toBeTrue();
  });

  it("shares the unambiguous upstream-scope argument builder", () => {
    expect(buildUpstreamGroupsArgs()).toEqual([
      "for-each-ref",
      "--format=%(refname:short)%09%(upstream:remotename)%09%(upstream:remoteref)",
      "refs/heads",
    ]);
  });
});

describe("remote ref builders", () => {
  it("mirrors one remote branch into its tracking ref", () => {
    expect(buildFetchTrackingRefArgs("origin", "feature/x")).toEqual([
      "fetch",
      "--progress",
      "--",
      "origin",
      "+refs/heads/feature/x:refs/remotes/origin/feature/x",
    ]);
  });

  it("lists heads and deletes only one tracking ref", () => {
    expect(buildLsRemoteHeadsArgs("origin")).toEqual(["ls-remote", "--heads", "--", "origin"]);
    expect(buildDeleteTrackingRefArgs("origin", "feature/x")).toEqual([
      "update-ref",
      "-d",
      "--",
      "refs/remotes/origin/feature/x",
    ]);
  });

  it("rejects an option-like or malformed remote and ref", () => {
    expect(buildLsRemoteHeadsArgs("-oops")).toBeNull();
    expect(buildFetchTrackingRefArgs("-oops", "main")).toBeNull();
    expect(buildFetchTrackingRefArgs("origin", "bad branch")).toBeNull();
    expect(buildDeleteTrackingRefArgs("origin", "refs..bad")).toBeNull();
  });

  it("prunes every stale tracking ref of one remote", () => {
    expect(buildRemotePruneArgs("origin")).toEqual(["remote", "prune", "--", "origin"]);
    expect(buildRemotePruneArgs("a/b")).toEqual(["remote", "prune", "--", "a/b"]);
  });

  it("rejects an option-like or malformed remote before prune", () => {
    expect(buildRemotePruneArgs("-oops")).toBeNull();
    expect(buildRemotePruneArgs("bad remote")).toBeNull();
    expect(buildRemotePruneArgs("")).toBeNull();
  });
});

describe("parseLsRemoteHeads", () => {
  it("reads branch names from tab-separated head lines", () => {
    expect(
      parseLsRemoteHeads(
        [
          "aaa\trefs/heads/main",
          "bbb\trefs/heads/feature/x",
          "ccc\trefs/tags/v1.0.0",
          "malformed",
          "",
          "aaa\trefs/heads/main",
        ].join("\n"),
      ),
    ).toEqual(["main", "feature/x"]);
  });

  it("ignores an empty or malformed response", () => {
    expect(parseLsRemoteHeads("")).toEqual([]);
    expect(parseLsRemoteHeads("not-a-head\n")).toEqual([]);
  });
});

/**
 * Builds one upstream descriptor.
 *
 * @param remote - Remote name.
 * @param branch - Branch inside the remote.
 * @returns The descriptor.
 */
function descriptor(remote: string, branch: string): UpstreamDescriptor {
  return { ref: `${remote}/${branch}`, remote, branch };
}

describe("readUpstreamGroups", () => {
  it("groups, dedupes, and sorts upstream refs per remote", () => {
    expect(
      readUpstreamGroups(
        [
          "main\torigin\trefs/heads/main",
          "feature\torigin\trefs/heads/feature",
          "local\t\t",
          "duplicate\torigin\trefs/heads/main",
          "upstream-main\tupstream\trefs/heads/main",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      { remote: "origin", refs: [descriptor("origin", "feature"), descriptor("origin", "main")] },
      { remote: "upstream", refs: [descriptor("upstream", "main")] },
    ]);
  });

  it("keeps a slash-named remote whole instead of splitting it", () => {
    expect(readUpstreamGroups("main\ta/b\trefs/heads/main\n")).toEqual([
      { remote: "a/b", refs: [descriptor("a/b", "main")] },
    ]);
  });

  it("skips malformed upstream columns", () => {
    expect(
      readUpstreamGroups(
        ["main\ta/b\t", "half\torigin", "tag\torigin\trefs/tags/v1.0.0", ""].join("\n"),
      ),
    ).toEqual([]);
  });

  it("returns no groups for an empty scope", () => {
    expect(readUpstreamGroups("")).toEqual([]);
  });

  it("filters to the exact local branch without matching a longer prefix", () => {
    const stdout = [
      "feature\torigin\trefs/heads/feature",
      "feature/x\torigin\trefs/heads/feature-x",
      "main\torigin\trefs/heads/main",
    ].join("\n");

    expect(readUpstreamGroups(stdout, { localBranch: "feature" })).toEqual([
      { remote: "origin", refs: [descriptor("origin", "feature")] },
    ]);
    expect(readUpstreamGroups(stdout, { localBranch: "feature/x" })).toEqual([
      { remote: "origin", refs: [descriptor("origin", "feature-x")] },
    ]);
    expect(readUpstreamGroups(stdout, { localBranch: "missing" })).toEqual([]);
  });
});

describe("planPruneDeletions", () => {
  it("fetches advertised refs and deletes only confirmed-stale in-scope refs", () => {
    expect(
      planPruneDeletions(
        "origin",
        [descriptor("origin", "main"), descriptor("origin", "feature")],
        ["main", "unrelated"],
      ),
    ).toEqual({
      fetchRefs: [descriptor("origin", "main")],
      deleteRefs: [descriptor("origin", "feature")],
    });
  });

  it("never returns an out-of-scope ref", () => {
    expect(planPruneDeletions("origin", [descriptor("upstream", "main")], [])).toEqual({
      fetchRefs: [],
      deleteRefs: [],
    });
  });

  it("plans fetch and delete with the exact slash-named remote", () => {
    expect(
      planPruneDeletions(
        "a/b",
        [descriptor("a/b", "main"), descriptor("a/b", "feature"), descriptor("a", "main")],
        ["main"],
      ),
    ).toEqual({
      fetchRefs: [descriptor("a/b", "main")],
      deleteRefs: [descriptor("a/b", "feature")],
    });
  });
});
