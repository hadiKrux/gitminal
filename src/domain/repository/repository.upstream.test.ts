import { describe, expect, it } from "bun:test";
import type { GitClient, GitInvocationResult } from "@/domain/git/git.types";
import type { UpstreamEvidence } from "@/domain/repository/repository.types";
import {
  classifyUpstream,
  confirmRemoteBranch,
  EMPTY_UPSTREAM_EVIDENCE,
  parseUpstreamRef,
  readUpstreamStatus,
  withAppDeletion,
  withPruneConfirmation,
  withUnknownCheck,
} from "@/domain/repository/repository.upstream";

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

describe("parseUpstreamRef", () => {
  it("splits a short upstream ref", () => {
    expect(parseUpstreamRef("origin/main")).toEqual({
      ref: "origin/main",
      remote: "origin",
      branch: "main",
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
});

describe("readUpstreamStatus", () => {
  const signal = new AbortController().signal;

  it("reads the configured ref from branch configuration", async () => {
    const client = createClient({
      "for-each-ref --format=%(upstream:short) refs/heads/main": result("origin/main\n"),
      "rev-parse --verify --quiet origin/main": result("abc123\n"),
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

  it("reports none when the branch has no configured upstream", async () => {
    const client = createClient({
      "for-each-ref --format=%(upstream:short) refs/heads/main": result("\n"),
    });

    const upstream = await readUpstreamStatus(client, {
      cwd: "/repo",
      signal,
      branch: "main",
      evidence: evidence(),
    });

    expect(upstream.status).toBe("none");
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
      "for-each-ref --format=%(upstream:short) refs/heads/main": result("origin/main\n"),
      "rev-parse --verify --quiet origin/main": result("", false),
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
