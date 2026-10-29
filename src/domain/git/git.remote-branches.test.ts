import { describe, expect, it } from "bun:test";
import {
  buildListRemoteBranchesArgs,
  groupByRemote,
  parseRemoteBranches,
  planCreateLocalBranchFromRemote,
  readRemoteBranches,
} from "@/domain/git/git.remote-branches";
import type { GitClient, GitInvocationResult } from "@/domain/git/git.types";

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

/** NUL field separator used by the recorded remote branch format. */
const NUL = "\u0000";

/**
 * Builds one NUL-separated remote branch line.
 *
 * @param ref - Full ref name.
 * @param tipOid - Tip commit id.
 * @param date - Committer date.
 * @param subject - Tip commit subject.
 * @param symref - Symbolic ref target, empty for a real branch.
 * @returns The joined line.
 */
function remoteBranchLine(
  ref: string,
  tipOid: string,
  date: string,
  subject: string,
  symref: string = "",
): string {
  return [ref, tipOid, date, subject, symref].join(NUL);
}

describe("buildListRemoteBranchesArgs", () => {
  it("reads every remote-tracking branch with a symbolic ref atom", () => {
    expect(buildListRemoteBranchesArgs()).toEqual([
      "for-each-ref",
      "--format=%(refname)%00%(objectname)%00%(committerdate:iso-strict)%00%(subject)%00%(symref)",
      "refs/remotes",
    ]);
  });
});

describe("parseRemoteBranches", () => {
  const remotes = ["origin", "team/up"];

  it("splits a ref into its remote and branch", () => {
    const stdout = remoteBranchLine(
      "refs/remotes/origin/main",
      "tip-main",
      "2026-10-20T10:00:00+02:00",
      "latest work",
    );

    expect(parseRemoteBranches(stdout, remotes)).toEqual([
      {
        ref: "refs/remotes/origin/main",
        remote: "origin",
        branch: "main",
        tipOid: "tip-main",
        committerDate: "2026-10-20T10:00:00+02:00",
        subject: "latest work",
      },
    ]);
  });

  it("drops symbolic refs such as origin/HEAD", () => {
    const stdout = [
      remoteBranchLine("refs/remotes/origin/HEAD", "tip", "", "", "refs/remotes/origin/main"),
      remoteBranchLine("refs/remotes/origin/main", "tip", "", "subject"),
    ].join("\n");

    expect(parseRemoteBranches(stdout, remotes).map((record) => record.branch)).toEqual(["main"]);
  });

  it("prefers the longest configured remote so a slash-named remote wins", () => {
    const stdout = [
      remoteBranchLine("refs/remotes/team/up/main", "tip-1", "", "one"),
      remoteBranchLine("refs/remotes/team/other", "tip-2", "", "two"),
    ].join("\n");

    expect(parseRemoteBranches(stdout, ["team", "team/up"])).toEqual([
      {
        ref: "refs/remotes/team/up/main",
        remote: "team/up",
        branch: "main",
        tipOid: "tip-1",
        committerDate: null,
        subject: "one",
      },
      {
        ref: "refs/remotes/team/other",
        remote: "team",
        branch: "other",
        tipOid: "tip-2",
        committerDate: null,
        subject: "two",
      },
    ]);
  });

  it("accepts remote records besides names", () => {
    const stdout = remoteBranchLine("refs/remotes/origin/main", "tip", "", "subject");

    expect(
      parseRemoteBranches(stdout, [{ name: "origin", fetchUrl: "url", pushUrl: null }]),
    ).toHaveLength(1);
  });

  it("skips unattributed, malformed, and empty refs", () => {
    const stdout = [
      remoteBranchLine("refs/remotes/unconfigured/main", "tip", "", "subject"),
      remoteBranchLine("refs/heads/main", "tip", "", "subject"),
      remoteBranchLine("refs/remotes/origin/main", "", "", "subject"),
      "short",
      "",
    ].join("\n");

    expect(parseRemoteBranches(stdout, remotes)).toEqual([]);
  });
});

describe("readRemoteBranches", () => {
  it("runs the remote branch read with the configured remotes", async () => {
    let args: readonly string[] = [];
    const client: GitClient = {
      gitPath: "git",
      invoke: async (options) => {
        args = options.args;

        return result(remoteBranchLine("refs/remotes/origin/main", "tip", "", "subject"));
      },
    };

    const read = await readRemoteBranches(
      client,
      { cwd: "/repo", signal: new AbortController().signal },
      ["origin"],
    );

    expect(args).toEqual(buildListRemoteBranchesArgs());
    expect(read.ok).toBeTrue();
    expect(read.remoteBranches).toHaveLength(1);
  });

  it("returns the classified failure and keeps no rows", async () => {
    const client: GitClient = { gitPath: "git", invoke: async () => result("", false) };
    const read = await readRemoteBranches(
      client,
      { cwd: "/repo", signal: new AbortController().signal },
      ["origin"],
    );

    expect(read.ok).toBeFalse();
    expect(read.remoteBranches).toEqual([]);
    expect(read.failure?.message).toBe("fatal: nope");
  });

  it("fails a truncated read", async () => {
    const client: GitClient = {
      gitPath: "git",
      invoke: async () => ({ ...result("refs/remotes/origin/main\n"), stdoutTruncated: true }),
    };
    const read = await readRemoteBranches(
      client,
      { cwd: "/repo", signal: new AbortController().signal },
      ["origin"],
    );

    expect(read.ok).toBeFalse();
    expect(read.failure?.message).toBe("git for-each-ref refs/remotes output was truncated");
  });
});

describe("groupByRemote", () => {
  it("orders tip commits newest first within unchanged remote groups and breaks equal instants by branch name", () => {
    const records = parseRemoteBranches(
      [
        remoteBranchLine(
          "refs/remotes/upstream/z-old",
          "u-old",
          "2020-01-01T00:00:00Z",
          "upstream old",
        ),
        remoteBranchLine(
          "refs/remotes/origin/alpha-old",
          "o-old",
          "2026-10-21T12:00:00Z",
          "origin old",
        ),
        remoteBranchLine(
          "refs/remotes/origin/zeta-new",
          "o-zeta",
          "2026-10-22T10:00:00+02:00",
          "same instant",
        ),
        remoteBranchLine(
          "refs/remotes/upstream/a-new",
          "u-new",
          "2030-01-01T00:00:00Z",
          "newer than every origin branch",
        ),
        remoteBranchLine(
          "refs/remotes/origin/beta-new",
          "o-beta",
          "2026-10-22T08:00:00Z",
          "same instant",
        ),
      ].join("\n"),
      ["upstream", "origin"],
    );
    const originalOrder = records.map((record) => record.ref);
    const groups = groupByRemote(records);

    expect(groups.map((group) => group.remote)).toEqual(["origin", "upstream"]);
    expect(groups.map((group) => group.branches.map((branch) => branch.branch))).toEqual([
      ["beta-new", "zeta-new", "alpha-old"],
      ["a-new", "z-old"],
    ]);
    expect(
      groups.every((group) => group.branches.every((branch) => branch.remote === group.remote)),
    ).toBeTrue();
    expect(groups[0]?.branches[0]).toBe(records[4]);
    expect(records.map((record) => record.ref)).toEqual(originalOrder);
  });

  it("puts missing and invalid timestamps last with a deterministic name tie-breaker", () => {
    const records = parseRemoteBranches(
      [
        remoteBranchLine("refs/remotes/origin/z-missing", "missing", "", "unknown"),
        remoteBranchLine("refs/remotes/origin/a-invalid", "invalid", "not-a-date", "invalid"),
        remoteBranchLine(
          "refs/remotes/origin/old-valid",
          "old",
          "1960-01-01T00:00:00Z",
          "valid before epoch",
        ),
        remoteBranchLine("refs/remotes/origin/new-valid", "new", "2026-10-22T08:00:00Z", "new"),
      ].join("\n"),
      ["origin"],
    );

    expect(groupByRemote(records)[0]?.branches.map((branch) => branch.branch)).toEqual([
      "new-valid",
      "old-valid",
      "a-invalid",
      "z-missing",
    ]);
  });

  it("sorts unknown commit dates by remote name then branch name", () => {
    const records = parseRemoteBranches(
      [
        remoteBranchLine("refs/remotes/origin/zeta", "t1", "", "one"),
        remoteBranchLine("refs/remotes/upstream/main", "t2", "", "two"),
        remoteBranchLine("refs/remotes/origin/alpha", "t3", "", "three"),
        remoteBranchLine("refs/remotes/origin/main", "t4", "", "four"),
      ].join("\n"),
      ["origin", "upstream"],
    );

    expect(groupByRemote(records)).toEqual([
      {
        remote: "origin",
        branches: [
          {
            ref: "refs/remotes/origin/alpha",
            remote: "origin",
            branch: "alpha",
            tipOid: "t3",
            committerDate: null,
            subject: "three",
          },
          {
            ref: "refs/remotes/origin/main",
            remote: "origin",
            branch: "main",
            tipOid: "t4",
            committerDate: null,
            subject: "four",
          },
          {
            ref: "refs/remotes/origin/zeta",
            remote: "origin",
            branch: "zeta",
            tipOid: "t1",
            committerDate: null,
            subject: "one",
          },
        ],
      },
      {
        remote: "upstream",
        branches: [
          {
            ref: "refs/remotes/upstream/main",
            remote: "upstream",
            branch: "main",
            tipOid: "t2",
            committerDate: null,
            subject: "two",
          },
        ],
      },
    ]);
  });

  it("returns no groups for no records", () => {
    expect(groupByRemote([])).toEqual([]);
  });
});

describe("planCreateLocalBranchFromRemote", () => {
  it("plans an atomic create with checkout", () => {
    expect(
      planCreateLocalBranchFromRemote({
        name: "local-topic",
        remoteRef: "origin/topic",
        checkout: true,
      }),
    ).toEqual({ ok: true, args: ["switch", "-c", "local-topic", "origin/topic"] });
  });

  it("plans a plain branch without checkout", () => {
    expect(
      planCreateLocalBranchFromRemote({
        name: "local-topic",
        remoteRef: "refs/remotes/origin/topic",
        checkout: false,
      }),
    ).toEqual({
      ok: true,
      args: ["branch", "local-topic", "refs/remotes/origin/topic"],
    });
  });

  it("rejects an unsafe local name or base ref", () => {
    expect(
      planCreateLocalBranchFromRemote({ name: "-oops", remoteRef: "origin/topic", checkout: true }),
    ).toEqual({ ok: false, error: 'invalid branch name "-oops"' });
    expect(
      planCreateLocalBranchFromRemote({ name: "ok", remoteRef: "bad ref", checkout: false }),
    ).toEqual({ ok: false, error: 'invalid remote ref "bad ref"' });
  });
});
