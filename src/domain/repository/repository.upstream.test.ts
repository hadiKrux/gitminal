import { describe, expect, it } from "bun:test";
import type { BranchRecord, GitClient, GitInvocationResult } from "@/domain/git/git.types";
import type { UpstreamEvidence } from "@/domain/repository/repository.types";
import {
  classifyBranchUpstreams,
  classifyUpstream,
  clearConfirmedPresence,
  confirmRemoteBranch,
  EMPTY_UPSTREAM_EVIDENCE,
  formatUpstreamRef,
  parseUpstreamAtoms,
  parseUpstreamRef,
  readUpstreamStatus,
  withAppDeletion,
  withPruneConfirmation,
  withUnknownCheck,
} from "@/domain/repository/repository.upstream";

/** Arguments that read the upstream atoms of one branch. */
const CURRENT_UPSTREAM_ARGS =
  "for-each-ref --format=%(upstream:remotename)%09%(upstream:remoteref) refs/heads/main";

/**
 * Builds an invocation result.
 *
 * @param stdout - Captured output.
 * @param ok - Whether git exited cleanly.
 * @param overrides - Result fields to override.
 * @returns The synthetic result.
 */
function result(
  stdout: string,
  ok: boolean = true,
  overrides: Partial<GitInvocationResult> = {},
): GitInvocationResult {
  return {
    argv: ["git"],
    cwd: "/repo",
    exitCode: ok ? 0 : 1,
    terminationSignal: null,
    stdout,
    stderr: ok ? "" : "fatal: failed",
    durationMs: 1,
    cancelled: false,
    timedOut: false,
    timedOutAfterMs: null,
    spawnError: null,
    ok,
    ...overrides,
  };
}

/**
 * Builds a client that answers from an argument table.
 *
 * @param answers - Map from joined arguments to a result.
 * @returns The fake client.
 */
function createClient(answers: Readonly<Record<string, GitInvocationResult>>): GitClient {
  return {
    gitPath: "git",
    invoke: async (options) => answers[options.args.join(" ")] ?? result("", false),
  };
}

/**
 * Builds evidence with overrides.
 *
 * @param overrides - Evidence values to override.
 * @returns The evidence.
 */
function evidence(overrides: Partial<UpstreamEvidence> = {}): UpstreamEvidence {
  return { ...EMPTY_UPSTREAM_EVIDENCE, ...overrides };
}

describe("formatUpstreamRef", () => {
  it("joins the exact remote and branch into the display ref", () => {
    expect(formatUpstreamRef("origin", "main")).toBe("origin/main");
    expect(formatUpstreamRef("a/b", "main")).toBe("a/b/main");
  });
});

describe("parseUpstreamAtoms", () => {
  it("reads the explicit remote name and branch ref", () => {
    expect(parseUpstreamAtoms("origin\trefs/heads/main")).toEqual({
      ref: "origin/main",
      remote: "origin",
      branch: "main",
    });
  });

  it("keeps a slash-named remote intact", () => {
    expect(parseUpstreamAtoms("a/b\trefs/heads/main")).toEqual({
      ref: "a/b/main",
      remote: "a/b",
      branch: "main",
    });
  });

  it("rejects a missing half or a non-branch ref", () => {
    expect(parseUpstreamAtoms("origin\t")).toBeNull();
    expect(parseUpstreamAtoms("\trefs/heads/main")).toBeNull();
    expect(parseUpstreamAtoms("origin\trefs/tags/v1.0.0")).toBeNull();
    expect(parseUpstreamAtoms("origin")).toBeNull();
    expect(parseUpstreamAtoms("")).toBeNull();
  });
});

describe("parseUpstreamRef", () => {
  it("splits a short upstream ref for display only", () => {
    expect(parseUpstreamRef("origin/main")).toEqual({
      ref: "origin/main",
      remote: "origin",
      branch: "main",
    });
  });

  it("is documented as ambiguous for a slash-named remote", () => {
    expect(parseUpstreamRef("a/b/main")).toEqual({
      ref: "a/b/main",
      remote: "a",
      branch: "b/main",
    });
  });

  it("rejects a ref without a remote or branch", () => {
    expect(parseUpstreamRef("main")).toBeNull();
    expect(parseUpstreamRef("origin/")).toBeNull();
  });
});

describe("classifyUpstream", () => {
  it("reports none when no upstream is configured", () => {
    expect(classifyUpstream({ configuredRef: null, refExists: false, evidence: evidence() })).toBe(
      "none",
    );
  });

  it("reports healthy when the tracking ref exists", () => {
    expect(
      classifyUpstream({ configuredRef: "origin/main", refExists: true, evidence: evidence() }),
    ).toBe("healthy");
  });

  it("reports gone before any prune confirmation, never deleted", () => {
    expect(
      classifyUpstream({ configuredRef: "origin/main", refExists: false, evidence: evidence() }),
    ).toBe("gone");
  });

  it("reports deleted only after a successful prune confirmation", () => {
    expect(
      classifyUpstream({
        configuredRef: "origin/main",
        refExists: false,
        evidence: evidence({ prunedRefs: ["origin/main"] }),
      }),
    ).toBe("deleted-after-prune");
  });

  it("reports deleted after a successful app-initiated remote deletion", () => {
    expect(
      classifyUpstream({
        configuredRef: "origin/main",
        refExists: false,
        evidence: evidence({ appDeletedRefs: ["origin/main"] }),
      }),
    ).toBe("deleted-after-app-deletion");
  });

  it("reports unknown after a failed remote check, never deleted", () => {
    expect(
      classifyUpstream({
        configuredRef: "origin/main",
        refExists: false,
        evidence: evidence({ unknownRefs: ["origin/main"] }),
      }),
    ).toBe("unknown");
  });

  it("prefers a stronger deletion claim over a failed check", () => {
    const strongEvidence = evidence({
      prunedRefs: ["origin/main"],
      unknownRefs: ["origin/main"],
    });

    expect(
      classifyUpstream({
        configuredRef: "origin/main",
        refExists: false,
        evidence: strongEvidence,
      }),
    ).toBe("deleted-after-prune");
  });

  it("reports healthy even while stale deletion evidence still exists", () => {
    expect(
      classifyUpstream({
        configuredRef: "origin/main",
        refExists: true,
        evidence: evidence({ prunedRefs: ["origin/main"], appDeletedRefs: ["origin/main"] }),
      }),
    ).toBe("healthy");
  });
});

describe("upstream evidence helpers", () => {
  it("adds a prune confirmation and clears the same ref's failed check", () => {
    const next = withPruneConfirmation(evidence({ unknownRefs: ["origin/main"] }), "origin/main");

    expect(next.prunedRefs).toEqual(["origin/main"]);
    expect(next.unknownRefs).toEqual([]);
  });

  it("adds an app deletion and clears the same ref's failed check", () => {
    const next = withAppDeletion(evidence({ unknownRefs: ["origin/main"] }), "origin/main");

    expect(next.appDeletedRefs).toEqual(["origin/main"]);
    expect(next.unknownRefs).toEqual([]);
  });

  it("keeps a failed check but never downgrades confirmed deletion evidence", () => {
    const pruned = withUnknownCheck(evidence({ prunedRefs: ["origin/main"] }), "origin/main");

    expect(pruned.prunedRefs).toEqual(["origin/main"]);
    expect(pruned.unknownRefs).toEqual([]);

    const unknown = withUnknownCheck(evidence(), "origin/main");

    expect(unknown.unknownRefs).toEqual(["origin/main"]);
  });

  it("clears prune and app-deletion evidence for a ref observed present again", () => {
    const stale = evidence({
      prunedRefs: ["origin/main", "origin/topic"],
      appDeletedRefs: ["origin/gone"],
    });

    const cleared = clearConfirmedPresence(stale, ["origin/main"]);

    expect(cleared.prunedRefs).toEqual(["origin/topic"]);
    expect(cleared.appDeletedRefs).toEqual(["origin/gone"]);
  });

  it("clears both evidence sets for the same re-observed ref", () => {
    const stale = evidence({
      prunedRefs: ["origin/main"],
      appDeletedRefs: ["origin/main"],
    });

    const cleared = clearConfirmedPresence(stale, ["origin/main"]);

    expect(cleared.prunedRefs).toEqual([]);
    expect(cleared.appDeletedRefs).toEqual([]);
  });

  it("returns the same evidence when nothing matches", () => {
    const stale = evidence({ prunedRefs: ["origin/main"] });

    expect(clearConfirmedPresence(stale, ["origin/topic"])).toBe(stale);
    expect(clearConfirmedPresence(EMPTY_UPSTREAM_EVIDENCE, ["origin/main"])).toBe(
      EMPTY_UPSTREAM_EVIDENCE,
    );
  });
});

describe("readUpstreamStatus", () => {
  const signal = new AbortController().signal;

  it("reads the configured ref from branch configuration", async () => {
    const client = createClient({
      [CURRENT_UPSTREAM_ARGS]: result("origin\trefs/heads/main\n"),
      "rev-parse --verify --quiet refs/remotes/origin/main": result("abc123\n"),
    });

    const upstream = await readUpstreamStatus(client, {
      cwd: "/repo",
      signal,
      branch: "main",
      evidence: evidence(),
    });

    expect(upstream).toEqual({
      status: "healthy",
      upstream: "origin/main",
      descriptor: { ref: "origin/main", remote: "origin", branch: "main" },
    });
  });

  it("keeps a slash-named upstream remote intact and checks the full tracking ref", async () => {
    const client = createClient({
      "for-each-ref --format=%(upstream:remotename)%09%(upstream:remoteref) refs/heads/foo":
        result("a/b\trefs/heads/main\n"),
      "rev-parse --verify --quiet refs/remotes/a/b/main": result("abc123\n"),
    });

    const upstream = await readUpstreamStatus(client, {
      cwd: "/repo",
      signal,
      branch: "foo",
      evidence: evidence(),
    });

    expect(upstream.upstream).toBe("a/b/main");
    expect(upstream.descriptor).toEqual({ ref: "a/b/main", remote: "a/b", branch: "main" });
    expect(upstream.status).toBe("healthy");
  });

  it("reports none when the branch has no configured upstream", async () => {
    const client = createClient({
      [CURRENT_UPSTREAM_ARGS]: result("\t\n"),
    });

    const upstream = await readUpstreamStatus(client, {
      cwd: "/repo",
      signal,
      branch: "main",
      evidence: evidence(),
    });

    expect(upstream.status).toBe("none");
  });

  it("reports unknown when either upstream half is missing", async () => {
    const client = createClient({
      [CURRENT_UPSTREAM_ARGS]: result("origin\t\n"),
    });

    const upstream = await readUpstreamStatus(client, {
      cwd: "/repo",
      signal,
      branch: "main",
      evidence: evidence(),
    });

    expect(upstream).toEqual({ status: "unknown", upstream: null, descriptor: null });
  });

  it("reports unknown when branch configuration cannot be read", async () => {
    const upstream = await readUpstreamStatus(createClient({}), {
      cwd: "/repo",
      signal,
      branch: "main",
      evidence: evidence(),
    });

    expect(upstream.status).toBe("unknown");
  });

  it("reports none for a detached HEAD", async () => {
    const upstream = await readUpstreamStatus(createClient({}), {
      cwd: "/repo",
      signal,
      branch: null,
      evidence: evidence(),
    });

    expect(upstream.status).toBe("none");
  });

  it("reports gone when the configured tracking ref is missing", async () => {
    const client = createClient({
      [CURRENT_UPSTREAM_ARGS]: result("origin\trefs/heads/main\n"),
      "rev-parse --verify --quiet refs/remotes/origin/main": result("", false),
    });

    const upstream = await readUpstreamStatus(client, {
      cwd: "/repo",
      signal,
      branch: "main",
      evidence: evidence(),
    });

    expect(upstream.status).toBe("gone");
  });
});

describe("confirmRemoteBranch", () => {
  const signal = new AbortController().signal;
  const descriptor = { ref: "origin/main", remote: "origin", branch: "main" };

  it("confirms presence when the remote advertises the head", async () => {
    const client = createClient({
      "ls-remote --heads origin refs/heads/main": result("abc123\trefs/heads/main\n"),
    });

    expect(await confirmRemoteBranch(client, { cwd: "/repo", signal }, descriptor)).toBe("present");
  });

  it("confirms absence only on a clean empty response", async () => {
    const client = createClient({
      "ls-remote --heads origin refs/heads/main": result(""),
    });

    expect(await confirmRemoteBranch(client, { cwd: "/repo", signal }, descriptor)).toBe("absent");
  });

  it("reports unknown for a failure, timeout, or cancellation", async () => {
    const failed = createClient({
      "ls-remote --heads origin refs/heads/main": result("", false),
    });
    const timedOut = createClient({
      "ls-remote --heads origin refs/heads/main": result("", false, {
        timedOut: true,
        timedOutAfterMs: 120_000,
      }),
    });

    expect(await confirmRemoteBranch(failed, { cwd: "/repo", signal }, descriptor)).toBe("unknown");
    expect(await confirmRemoteBranch(timedOut, { cwd: "/repo", signal }, descriptor)).toBe(
      "unknown",
    );
  });
});

/**
 * Builds one local branch with a configured upstream.
 *
 * @param name - Branch name.
 * @param upstream - Configured upstream ref, or null.
 * @returns The branch record.
 */
function branchWithUpstream(name: string, upstream: string | null): BranchRecord {
  const [remote, ...rest] = upstream === null ? [] : upstream.split("/");

  return {
    name,
    head: false,
    tipOid: "abc123",
    committerDate: null,
    upstream,
    upstreamRemote: remote ?? null,
    upstreamBranch: rest.length === 0 ? null : rest.join("/"),
    ahead: 0,
    behind: 0,
    worktreePath: null,
    upstreamStatus: upstream === null ? "none" : "unknown",
  };
}

describe("classifyBranchUpstreams", () => {
  it("maps every classification to its branch row status", () => {
    const branches = [
      branchWithUpstream("tracked", "origin/tracked"),
      branchWithUpstream("gone", "origin/gone"),
      branchWithUpstream("unknown", "origin/unknown"),
      branchWithUpstream("pruned", "origin/pruned"),
      branchWithUpstream("deleted", "origin/deleted"),
    ];
    const remoteBranches = [
      {
        ref: "refs/remotes/origin/tracked",
        remote: "origin",
        branch: "tracked",
        tipOid: "abc123",
        committerDate: null,
        subject: "subject",
      },
    ];
    let evidence: UpstreamEvidence = EMPTY_UPSTREAM_EVIDENCE;
    evidence = withUnknownCheck(evidence, "origin/unknown");
    evidence = withPruneConfirmation(evidence, "origin/pruned");
    evidence = withAppDeletion(evidence, "origin/deleted");

    const classified = classifyBranchUpstreams(branches, remoteBranches, evidence);

    expect(classified.map((branch) => branch.upstreamStatus)).toEqual([
      "tracked",
      "notFound",
      "unknown",
      "deleted",
      "deleted",
    ]);
    expect(classified[0]?.upstream).toBe("origin/tracked");
  });

  it("keeps a branch without an upstream as none", () => {
    const classified = classifyBranchUpstreams(
      [branchWithUpstream("feature", null)],
      [],
      EMPTY_UPSTREAM_EVIDENCE,
    );

    expect(classified[0]?.upstreamStatus).toBe("none");
  });
});
