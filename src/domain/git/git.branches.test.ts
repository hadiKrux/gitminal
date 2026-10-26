import { describe, expect, it } from "bun:test";
import {
  buildBranchRiskArgs,
  buildListLocalBranchesArgs,
  isValidBranchName,
  parseBranchRiskCommits,
  parseLocalBranches,
  planCheckoutBranch,
  planCreateBranch,
  planDeleteLocalBranch,
  planDeleteRemoteBranch,
  readBranchRisk,
  readLocalBranches,
  resolveBranchMergeTarget,
} from "@/domain/git/git.branches";
import type {
  BranchRecord,
  GitClient,
  GitInvocationResult,
  RemoteBranchRecord,
} from "@/domain/git/git.types";

/** NUL field separator used by the recorded branch format. */
const NUL = "\u0000";

/** The exact format atom string the branch read must use. */
const EXPECTED_FORMAT =
  "--format=%(refname:short)%00%(objectname)%00%(HEAD)%00%(committerdate:iso-strict)" +
  "%00%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream:track)";

/**
 * Builds one NUL-separated branch line.
 *
 * @param fields - The seven atoms in format order.
 * @returns The joined line.
 */
function branchLine(
  fields: readonly [string, string, string, string, string, string, string],
): string {
  return fields.join(NUL);
}

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
    stderr: ok ? "" : "fatal: bad revision",
    durationMs: 1,
    cancelled: false,
    timedOut: false,
    timedOutAfterMs: null,
    spawnError: null,
    ok,
  };
}

/** Branch line fields shared by the track variants. */
const BASE = {
  date: "2026-10-20T10:00:00+02:00",
  remote: "origin",
  branchRef: "refs/heads/main",
} as const;

/**
 * Builds one branch record with overrides.
 *
 * @param overrides - Branch values to override.
 * @returns The branch record.
 */
function branchRecord(overrides: Partial<BranchRecord> = {}): BranchRecord {
  return {
    name: "topic",
    head: false,
    tipOid: "abc123",
    committerDate: null,
    upstream: null,
    upstreamRemote: null,
    upstreamBranch: null,
    ahead: 0,
    behind: 0,
    worktreePath: null,
    upstreamStatus: "none",
    ...overrides,
  };
}

describe("buildListLocalBranchesArgs", () => {
  it("reads every local branch in one for-each-ref invocation", () => {
    expect(buildListLocalBranchesArgs()).toEqual(["for-each-ref", EXPECTED_FORMAT, "refs/heads"]);
  });

  it("separates every atom with NUL", () => {
    expect(EXPECTED_FORMAT).toContain("%(refname:short)%00%(objectname)");
    expect(EXPECTED_FORMAT).toContain("%(upstream:remotename)%00%(upstream:remoteref)");
    expect(EXPECTED_FORMAT).toContain("%(upstream:track)");
  });
});

describe("parseLocalBranches", () => {
  it("parses a current branch with an up-to-date upstream", () => {
    const stdout = branchLine([
      "main",
      "tip-main",
      "*",
      BASE.date,
      BASE.remote,
      BASE.branchRef,
      "",
    ]);

    expect(parseLocalBranches(stdout)).toEqual([
      {
        name: "main",
        head: true,
        tipOid: "tip-main",
        committerDate: BASE.date,
        upstream: "origin/main",
        upstreamRemote: "origin",
        upstreamBranch: "main",
        ahead: 0,
        behind: 0,
        worktreePath: null,
        upstreamStatus: "unknown",
      },
    ]);
  });

  it("parses ahead only, behind only, and diverged track counts", () => {
    const stdout = [
      branchLine(["ahead", "t1", " ", BASE.date, "origin", "refs/heads/ahead", "[ahead 2]"]),
      branchLine(["behind", "t2", " ", BASE.date, "origin", "refs/heads/behind", "[behind 3]"]),
      branchLine([
        "diverged",
        "t3",
        " ",
        BASE.date,
        "origin",
        "refs/heads/diverged",
        "[ahead 1, behind 4]",
      ]),
    ].join("\n");
    const branches = parseLocalBranches(stdout);

    expect(branches.map((branch) => [branch.ahead, branch.behind])).toEqual([
      [2, 0],
      [0, 3],
      [1, 4],
    ]);
  });

  it("keeps zero counts for a gone upstream", () => {
    const [gone] = parseLocalBranches(
      branchLine(["old", "t4", " ", BASE.date, "origin", "refs/heads/old", "[gone]"]),
    );

    expect(gone?.upstream).toBe("origin/old");
    expect(gone?.ahead).toBe(0);
    expect(gone?.behind).toBe(0);
  });

  it("reports no upstream when the configured atoms are empty", () => {
    const [local] = parseLocalBranches(branchLine(["local", "t5", " ", BASE.date, "", "", ""]));

    expect(local).toEqual({
      name: "local",
      head: false,
      tipOid: "t5",
      committerDate: BASE.date,
      upstream: null,
      upstreamRemote: null,
      upstreamBranch: null,
      ahead: 0,
      behind: 0,
      worktreePath: null,
      upstreamStatus: "none",
    });
  });

  it("keeps a slash-named upstream remote intact", () => {
    const [branch] = parseLocalBranches(
      branchLine(["topic", "t6", "*", BASE.date, "team/up", "refs/heads/main", "[ahead 1]"]),
    );

    expect(branch?.upstream).toBe("team/up/main");
    expect(branch?.upstreamRemote).toBe("team/up");
    expect(branch?.upstreamBranch).toBe("main");
  });

  it("reports a null committer date when git has none", () => {
    const [branch] = parseLocalBranches(branchLine(["empty", "t7", " ", "", "", "", ""]));

    expect(branch?.committerDate).toBeNull();
  });

  it("marks only the star atom as HEAD", () => {
    const stdout = [
      branchLine(["current", "t8", "*", BASE.date, "", "", ""]),
      branchLine(["other", "t9", " ", BASE.date, "", "", ""]),
    ].join("\n");

    expect(parseLocalBranches(stdout).map((branch) => branch.head)).toEqual([true, false]);
  });

  it("skips malformed and short lines", () => {
    const stdout = ["main", "main\0tip", "", "\0\0\0\0\0\0\0"].join("\n");

    expect(parseLocalBranches(stdout)).toEqual([]);
  });
});

describe("readLocalBranches", () => {
  it("runs the one branch read and parses the result", async () => {
    let args: readonly string[] = [];
    const client: GitClient = {
      gitPath: "git",
      invoke: async (options) => {
        args = options.args;

        return result(branchLine(["main", "t1", "*", BASE.date, "", "", ""]));
      },
    };

    const read = await readLocalBranches(client, {
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(args).toEqual(buildListLocalBranchesArgs());
    expect(read.ok).toBeTrue();
    expect(read.branches).toHaveLength(1);
    expect(read.failure).toBeNull();
  });

  it("returns the classified failure instead of throwing", async () => {
    const client: GitClient = {
      gitPath: "git",
      invoke: async () => result("", false),
    };

    const read = await readLocalBranches(client, {
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(read.ok).toBeFalse();
    expect(read.branches).toEqual([]);
    expect(read.failure?.message).toBe("fatal: bad revision");
  });

  it("fails a truncated read so the previous snapshot is kept", async () => {
    const client: GitClient = {
      gitPath: "git",
      invoke: async () => ({ ...result("main\n"), stdoutTruncated: true }),
    };

    const read = await readLocalBranches(client, {
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(read.ok).toBeFalse();
    expect(read.failure?.message).toBe("git for-each-ref refs/heads output was truncated");
  });
});

describe("resolveBranchMergeTarget", () => {
  const remoteBranches: readonly RemoteBranchRecord[] = [
    {
      ref: "refs/remotes/team/up/main",
      remote: "team/up",
      branch: "main",
      tipOid: "abc123",
      committerDate: null,
      subject: "initial commit",
    },
  ];

  it("uses the unambiguous remote-tracking ref of a present configured upstream", () => {
    expect(
      resolveBranchMergeTarget({
        branch: branchRecord({
          upstream: "team/up/main",
          upstreamRemote: "team/up",
          upstreamBranch: "main",
        }),
        remoteBranches,
        fallbackUpstream: null,
      }),
    ).toBe("refs/remotes/team/up/main");
  });

  it("falls back to HEAD when the configured upstream ref is missing", () => {
    expect(
      resolveBranchMergeTarget({
        branch: branchRecord({
          upstream: "origin/topic",
          upstreamRemote: "origin",
          upstreamBranch: "topic",
        }),
        remoteBranches,
        fallbackUpstream: null,
      }),
    ).toBe("HEAD");
  });

  it("uses the caller upstream only while its ref exists, then HEAD", () => {
    expect(
      resolveBranchMergeTarget({
        branch: branchRecord(),
        remoteBranches,
        fallbackUpstream: "team/up/main",
      }),
    ).toBe("refs/remotes/team/up/main");
    expect(
      resolveBranchMergeTarget({
        branch: branchRecord(),
        remoteBranches,
        fallbackUpstream: "origin/main",
      }),
    ).toBe("HEAD");
    expect(resolveBranchMergeTarget({ branch: null, remoteBranches, fallbackUpstream: null })).toBe(
      "HEAD",
    );
  });
});

describe("branch planners", () => {
  it("plans a checkout", () => {
    expect(planCheckoutBranch("feature/x")).toEqual({
      ok: true,
      args: ["checkout", "feature/x"],
    });
  });

  it("plans an atomic create with checkout and a plain branch without it", () => {
    expect(planCreateBranch({ name: "topic", startPoint: "HEAD", checkout: true })).toEqual({
      ok: true,
      args: ["switch", "-c", "topic", "HEAD"],
    });
    expect(planCreateBranch({ name: "topic", startPoint: "abc123", checkout: false })).toEqual({
      ok: true,
      args: ["branch", "topic", "abc123"],
    });
  });

  it("defaults an empty start point to HEAD", () => {
    expect(planCreateBranch({ name: "topic", startPoint: "", checkout: true })).toEqual({
      ok: true,
      args: ["switch", "-c", "topic", "HEAD"],
    });
  });

  it("selects -d or -D from the force acknowledgement", () => {
    expect(planDeleteLocalBranch("topic", false)).toEqual({
      ok: true,
      args: ["branch", "-d", "topic"],
    });
    expect(planDeleteLocalBranch("topic", true)).toEqual({
      ok: true,
      args: ["branch", "-D", "topic"],
    });
  });

  it("plans a remote delete with the remote and branch as separate values", () => {
    expect(planDeleteRemoteBranch("origin", "topic")).toEqual({
      ok: true,
      args: ["push", "--progress", "--delete", "--", "origin", "topic"],
    });
  });

  it("rejects unsafe values before they reach git", () => {
    expect(planCheckoutBranch("-oops")).toEqual({
      ok: false,
      error: 'invalid branch name "-oops"',
    });
    expect(planCheckoutBranch("a..b").ok).toBeFalse();
    expect(planCheckoutBranch("bad name").ok).toBeFalse();
    expect(
      planCreateBranch({ name: "topic", startPoint: "HEAD~2", checkout: true }).ok,
    ).toBeFalse();
    expect(
      planCreateBranch({ name: "-topic", startPoint: "HEAD", checkout: false }).ok,
    ).toBeFalse();
    expect(planDeleteLocalBranch("", false).ok).toBeFalse();
    expect(planDeleteRemoteBranch("--upload-pack", "topic").ok).toBeFalse();
    expect(planDeleteRemoteBranch("origin", "bad\nname").ok).toBeFalse();
  });
});

describe("isValidBranchName", () => {
  const cases: readonly (readonly [string, boolean])[] = [
    ["main", true],
    ["feature/AB-1231", true],
    ["a/b/c", true],
    ["release-1.0", true],
    ["v1.0.0", true],
    ["topic_1", true],
    ["", false],
    ["-topic", false],
    ["topic ", false],
    [" topic", false],
    ["bad\tname", false],
    ["a..b", false],
    ["a@{1}", false],
    ["a~1", false],
    ["a^", false],
    ["a:b", false],
    ["a?", false],
    ["a*", false],
    ["a[", false],
    ["a\\b", false],
    ["/main", false],
    ["main/", false],
    ["a//b", false],
    [".hidden", false],
    ["a/.hidden", false],
    ["a.lock", false],
    ["foo.lock/bar", false],
    ["a/b.lock", false],
    ["a.", false],
    ["@", false],
    ["HEAD", false],
    ["@{", false],
  ];

  it("accepts legal branch names and rejects every invalid form", () => {
    for (const [name, expected] of cases) {
      expect([name, isValidBranchName(name)]).toEqual([name, expected]);
    }
  });
});

describe("branch risk", () => {
  const signal = new AbortController().signal;

  it("plans one capped NUL-separated log range against a base", () => {
    expect(buildBranchRiskArgs("HEAD", "topic")).toEqual([
      "log",
      "--format=%H%x00%s",
      "--max-count=21",
      "HEAD..topic",
    ]);
  });

  it("parses commit id and subject pairs and skips blank lines", () => {
    expect(parseBranchRiskCommits("abc\0first commit\ndef\0second commit\n\n")).toEqual([
      { oid: "abc", subject: "first commit" },
      { oid: "def", subject: "second commit" },
    ]);
  });

  it("reads the commits the resolved base does not contain", async () => {
    let args: readonly string[] = [];
    const client: GitClient = {
      gitPath: "git",
      invoke: async (options) => {
        args = options.args;

        return result("abc\0subject one\n");
      },
    };

    const read = await readBranchRisk(
      client,
      { cwd: "/repo", signal },
      { name: "topic", base: "refs/remotes/origin/main" },
    );

    expect(args).toEqual(buildBranchRiskArgs("refs/remotes/origin/main", "topic"));
    expect(read).toEqual({
      commits: [{ oid: "abc", subject: "subject one" }],
      merged: false,
      hasMore: false,
      error: null,
    });
  });

  it("reports a successful read with an empty list as merged", async () => {
    const client: GitClient = { gitPath: "git", invoke: async () => result("") };

    const read = await readBranchRisk(
      client,
      { cwd: "/repo", signal },
      { name: "topic", base: "HEAD" },
    );

    expect(read).toEqual({ commits: [], merged: true, hasMore: false, error: null });
  });

  it("caps the list and reports that older commits are hidden", async () => {
    const output = Array.from({ length: 21 }, (_, index) => `oid${index}\0subject ${index}`).join(
      "\n",
    );
    const client: GitClient = { gitPath: "git", invoke: async () => result(output) };

    const read = await readBranchRisk(
      client,
      { cwd: "/repo", signal },
      { name: "topic", base: "HEAD" },
    );

    expect(read.commits).toHaveLength(20);
    expect(read.commits[0]?.subject).toBe("subject 0");
    expect(read.merged).toBe(false);
    expect(read.hasMore).toBe(true);
    expect(read.error).toBeNull();
  });

  it("returns the classified error and an unknown merge state instead of throwing", async () => {
    const client: GitClient = { gitPath: "git", invoke: async () => result("", false) };

    const read = await readBranchRisk(
      client,
      { cwd: "/repo", signal },
      { name: "topic", base: "HEAD" },
    );

    expect(read.commits).toEqual([]);
    expect(read.merged).toBeNull();
    expect(read.hasMore).toBe(false);
    expect(read.error).toBe("fatal: bad revision");
  });

  it("rejects an unsafe branch or base before reaching git", async () => {
    let calls = 0;
    const client: GitClient = {
      gitPath: "git",
      invoke: async () => {
        calls += 1;

        return result("");
      },
    };

    const invalidName = await readBranchRisk(
      client,
      { cwd: "/repo", signal },
      { name: "-topic", base: "HEAD" },
    );
    const invalidBase = await readBranchRisk(
      client,
      { cwd: "/repo", signal },
      { name: "topic", base: "HEAD~2" },
    );

    expect(invalidName).toEqual({
      commits: [],
      merged: null,
      hasMore: false,
      error: 'invalid branch name "-topic"',
    });
    expect(invalidBase.merged).toBeNull();
    expect(invalidBase.error).toContain("invalid branch base");
    expect(calls).toBe(0);
  });

  it("fails a truncated read instead of returning a partial list", async () => {
    const client: GitClient = {
      gitPath: "git",
      invoke: async () => ({ ...result("abc\0subject\n"), stdoutTruncated: true }),
    };

    const read = await readBranchRisk(
      client,
      { cwd: "/repo", signal },
      { name: "topic", base: "HEAD" },
    );

    expect(read.commits).toEqual([]);
    expect(read.merged).toBeNull();
    expect(read.error).toBe("git log output was truncated");
  });
});
