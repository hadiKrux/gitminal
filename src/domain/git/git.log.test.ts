import { describe, expect, it } from "bun:test";
import {
  buildCommitDetailsArgs,
  buildCommitStatsArgs,
  buildLogPageArgs,
  buildSearchPageArgs,
  COMMIT_DETAILS_FIELD_SEPARATOR,
  COMMIT_DETAILS_FORMAT_VERSION,
  COMMIT_DETAILS_RECORD_SEPARATOR,
  COMMIT_STATS_FILE_CAP,
  GRAPH_LOG_FIELD_SEPARATOR,
  GRAPH_LOG_FORMAT_VERSION,
  GRAPH_LOG_RECORD_SEPARATOR,
  readCommitDetails,
  readCommitStats,
  readLogPage,
  readSearchPage,
  resolveGraphScopeArgs,
} from "@/domain/git/git.log";
import type { GitClient, GitInvocationResult, GitOperationClass } from "@/domain/git/git.types";

/** NUL field separator of one record. */
const NUL = GRAPH_LOG_FIELD_SEPARATOR;

/** Record separator that starts and ends one record. */
const RS = GRAPH_LOG_RECORD_SEPARATOR;

/** Versioned format from the ticket, used to assert argument construction. */
const EXPECTED_FORMAT = "%x1e1%x00%H%x00%P%x00%an%x00%ae%x00%aI%x00%ct%x00%D%x00%s%x00%b%x1e";

/** Expected single-record details format built from the exported version. */
const EXPECTED_DETAILS_FORMAT = `%x1e${COMMIT_DETAILS_FORMAT_VERSION}%x00%H%x00%h%x00%T%x00%P%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%D%x00%B`;

/** One recorded invocation. */
interface RecordedCall {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly operationClass: GitOperationClass;
}

/**
 * Builds one successful invocation result.
 *
 * @param stdout - Captured standard output.
 * @returns The synthetic result.
 */
function okResult(stdout: string): GitInvocationResult {
  return {
    argv: ["git"],
    cwd: "/repo",
    exitCode: 0,
    terminationSignal: null,
    stdout,
    stderr: "",
    durationMs: 1,
    cancelled: false,
    timedOut: false,
    timedOutAfterMs: null,
    spawnError: null,
    ok: true,
  };
}

/**
 * Builds one failed invocation result.
 *
 * @param stderr - Captured standard error.
 * @returns The synthetic result.
 */
function failResult(stderr: string): GitInvocationResult {
  return {
    ...okResult(""),
    exitCode: 128,
    stderr,
    ok: false,
  };
}

/**
 * Creates a client that records every invocation and returns one result.
 *
 * @param result - Result every invocation returns.
 * @returns The client and its recorded calls.
 */
function createClient(result: GitInvocationResult): {
  readonly client: GitClient;
  readonly calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const client: GitClient = {
    gitPath: "git",
    invoke: async (options) => {
      calls.push({
        args: options.args,
        cwd: options.cwd,
        operationClass: options.operationClass,
      });

      return result;
    },
  };

  return { client, calls };
}

/** Fields every version-1 record fixture shares unless the test overrides them. */
const RECORD_DEFAULTS = {
  parents: [] as readonly string[],
  body: "",
  raw: [] as readonly string[],
  numstat: [] as readonly string[],
};

/**
 * Builds one version-1 record.
 *
 * @param input - OID, subject, and optional overrides of the shared defaults.
 * @returns The raw record bytes.
 */
function record(input: {
  readonly oid: string;
  readonly parents?: readonly string[];
  readonly subject: string;
  readonly body?: string;
  readonly raw?: readonly string[];
  readonly numstat?: readonly string[];
}): string {
  const values = { ...RECORD_DEFAULTS, ...input };
  const fields = [
    values.oid,
    values.parents.join(" "),
    "Probe User",
    "probe@example.com",
    "2026-10-25T20:09:30-06:00",
    "1792980570",
    "",
    values.subject,
    values.body,
  ].join(NUL);
  const header = `${RS}${GRAPH_LOG_FORMAT_VERSION}${NUL}${fields}${RS}${NUL}`;
  const fileTokens = `${values.raw.join("")}${values.numstat.join("")}`;
  const fileBlock = fileTokens.length === 0 ? "" : `\n${fileTokens}`;

  return header + fileBlock;
}

/** Abort signal used by the read options. */
const SIGNAL = new AbortController().signal;

describe("resolveGraphScopeArgs", () => {
  it("resolves every scope and includes HEAD in all and local", () => {
    expect(resolveGraphScopeArgs("all")).toEqual(["--branches", "--remotes", "HEAD"]);
    expect(resolveGraphScopeArgs("local")).toEqual(["--branches", "HEAD"]);
    expect(resolveGraphScopeArgs("current")).toEqual(["HEAD"]);
  });
});

describe("buildLogPageArgs", () => {
  it("passes the scope on the first page and never an offset", () => {
    const args = buildLogPageArgs({
      scopeArgs: resolveGraphScopeArgs("all"),
      limit: 500,
    });

    expect(args.slice(0, 10)).toEqual([
      "log",
      "--topo-order",
      "--parents",
      "--decorate=full",
      "--raw",
      "--numstat",
      "-z",
      "--diff-merges=first-parent",
      "--root",
      "--max-count=500",
    ]);
    expect(args).toContain(`--format=${EXPECTED_FORMAT}`);
    expect(args).toContain("--branches");
    expect(args).toContain("--remotes");
    expect(args).toContain("HEAD");
    expect(args).not.toContain("--skip");
  });

  it("continues from the frontier alone without repeating the scope", () => {
    const args = buildLogPageArgs({
      scopeArgs: resolveGraphScopeArgs("all"),
      limit: 500,
      frontier: ["abc123", "def456"],
    });

    expect(args).not.toContain("--branches");
    expect(args).not.toContain("--remotes");
    expect(args).not.toContain("HEAD");
    expect(args.slice(-2)).toEqual(["abc123", "def456"]);
    expect(args).not.toContain("--skip");
  });

  it("normalizes a non-positive page size", () => {
    const args = buildLogPageArgs({ scopeArgs: resolveGraphScopeArgs("current"), limit: 0 });

    expect(args).toContain("--max-count=1");
  });
});

describe("buildSearchPageArgs", () => {
  it("builds AND, case-insensitive, fixed-string matching over the full scope", () => {
    const args = buildSearchPageArgs({
      scopeArgs: resolveGraphScopeArgs("local"),
      terms: ["fix", "[bug]"],
      limit: 250,
    });

    expect(args).toContain("--fixed-strings");
    expect(args).toContain("-i");
    expect(args).toContain("--all-match");
    expect(args).toContain("--raw");
    expect(args).toContain("--numstat");
    expect(args).toContain("-z");
    expect(args).toContain("--diff-merges=first-parent");
    expect(args).toContain("--root");
    expect(args).toContain("--max-count=250");
    expect(args).toContain(`--format=${EXPECTED_FORMAT}`);
    expect(args.filter((argument) => argument === "--grep")).toHaveLength(2);
    expect(args).toContain("[bug]");
    expect(args).toContain("--branches");
    expect(args).toContain("HEAD");
    expect(args).not.toContain("--skip=0");
    expect(args.some((argument) => argument.startsWith("--skip="))).toBe(false);
  });

  it("adds only the stable offset on a continuation page", () => {
    const args = buildSearchPageArgs({
      scopeArgs: resolveGraphScopeArgs("all"),
      terms: ["fix"],
      limit: 250,
      offset: 2,
    });

    expect(args).toContain("--skip=2");
    expect(args).toContain("--branches");
    expect(args).toContain("--remotes");
    expect(args).toContain("HEAD");
    expect(args).not.toContain("--skip=0");
  });
});

describe("readLogPage", () => {
  it("reads a page with the versioned arguments and parses its rows", async () => {
    const { client, calls } = createClient(
      okResult(
        record({
          oid: "merge001",
          parents: ["parent1", "parent2"],
          subject: "merge side",
          body: "body line\n",
          raw: [`:100644 100644 aaaaaaa bbbbbbb A${NUL}side.txt${NUL}`],
          numstat: [`4${"\t"}0${"\t"}side.txt${NUL}`],
        }),
      ),
    );

    const result = await readLogPage(client, {
      cwd: "/repo",
      signal: SIGNAL,
      scope: "all",
      limit: 10,
      frontier: ["abc123"],
    });
    const [call] = calls;

    expect(result.ok).toBe(true);
    expect(result.rows[0]).toMatchObject({
      oid: "merge001",
      subject: "merge side",
      fileCount: 1,
      additions: 4,
    });
    expect(result.done).toBe(true);
    expect(result.failure).toBeNull();
    expect(call).toMatchObject({ operationClass: "read", cwd: "/repo" });
    expect(call?.args).toEqual(
      expect.arrayContaining(["--parents", "--diff-merges=first-parent", "--root"]),
    );
    expect(call?.args.at(-1)).toBe("abc123");
    expect(call?.args).not.toContain("--branches");
    expect(call?.args).not.toContain("HEAD");
  });

  it("reports more history when the page reached the requested limit", async () => {
    const { client } = createClient(okResult(record({ oid: "one0001", subject: "one" })));

    const result = await readLogPage(client, {
      cwd: "/repo",
      signal: SIGNAL,
      scope: "current",
      limit: 1,
    });

    expect(result.ok).toBe(true);
    expect(result.done).toBe(false);
  });

  it("returns a classified git failure without throwing", async () => {
    const { client } = createClient(failResult("fatal: bad revision 'missing'"));

    const result = await readLogPage(client, {
      cwd: "/repo",
      signal: SIGNAL,
      scope: "local",
      limit: 10,
    });

    expect(result.ok).toBe(false);
    expect(result.rows).toEqual([]);
    expect(result.failure?.kind).toBe("git");
    expect(result.failure?.message).toContain("bad revision");
  });

  it("returns a typed parse failure for a repeated OID", async () => {
    const duplicate = record({ oid: "same001", subject: "one" });
    const { client } = createClient(okResult(duplicate + duplicate));

    const result = await readLogPage(client, {
      cwd: "/repo",
      signal: SIGNAL,
      scope: "all",
      limit: 10,
    });

    expect(result.ok).toBe(false);
    expect(result.failure?.kind).toBe("parse");

    if (result.failure?.kind === "parse") {
      expect(result.failure.parse.kind).toBe("duplicate-oid");
    }
  });
});

describe("readSearchPage", () => {
  it("returns an exhausted page without invoking git for no terms", async () => {
    const { client, calls } = createClient(okResult(""));

    const result = await readSearchPage(client, {
      cwd: "/repo",
      signal: SIGNAL,
      scope: "all",
      terms: [],
      limit: 10,
    });

    expect(result).toEqual({ ok: true, rows: [], done: true, failure: null });
    expect(calls).toHaveLength(0);
  });

  it("reads a matching page with the full display row", async () => {
    const { client, calls } = createClient(
      okResult(record({ oid: "match01", subject: "fix the bug", body: "details\n" })),
    );

    const result = await readSearchPage(client, {
      cwd: "/repo",
      signal: SIGNAL,
      scope: "all",
      terms: ["fix", "bug"],
      limit: 50,
    });

    expect(result.ok).toBe(true);
    expect(result.rows[0]?.subject).toBe("fix the bug");
    expect(result.rows[0]?.body).toBe("details");
    expect(calls[0]?.args.filter((argument) => argument === "--grep")).toHaveLength(2);
    expect(calls[0]?.args).toContain("--all-match");
    expect(calls[0]?.args).toContain("--branches");
    expect(calls[0]?.args).not.toContain("--skip=0");
    expect(calls[0]?.args.some((argument) => argument.startsWith("--skip="))).toBe(false);
  });

  it("continues from the stable offset over the same scope", async () => {
    const { client, calls } = createClient(okResult(""));

    const result = await readSearchPage(client, {
      cwd: "/repo",
      signal: SIGNAL,
      scope: "all",
      terms: ["fix"],
      limit: 50,
      offset: 3,
    });

    expect(result).toEqual({ ok: true, rows: [], done: true, failure: null });
    expect(calls[0]?.args).toContain("--skip=3");
    expect(calls[0]?.args).toContain("--branches");
    expect(calls[0]?.args).toContain("--remotes");
    expect(calls[0]?.args).toContain("HEAD");
  });
});

/** NUL separator of the commit details record. */
const DETAILS_NUL = COMMIT_DETAILS_FIELD_SEPARATOR;

/** Record marker of the commit details record. */
const DETAILS_RS = COMMIT_DETAILS_RECORD_SEPARATOR;

/** Field defaults every commit-details fixture shares unless the test overrides them. */
const DETAILS_DEFAULTS = {
  treeOid: "tree000",
  parents: [] as readonly string[],
  authorName: "Alice Ng",
  authorEmail: "alice@example.com",
  authorDate: "2026-10-25T09:30:00+00:00",
  committerName: "Alice Ng",
  committerEmail: "alice@example.com",
  committerDate: "2026-10-25T09:30:00+00:00",
  decorations: [] as readonly string[],
  message: "subject\n\nbody\n",
};

/**
 * Builds one versioned commit details record.
 *
 * @param input - OID plus optional overrides of the shared field defaults.
 * @returns The raw record bytes with git's trailing newline.
 */
function detailsRecord(input: {
  readonly oid: string;
  readonly shortOid?: string;
  readonly treeOid?: string;
  readonly parents?: readonly string[];
  readonly authorName?: string;
  readonly authorEmail?: string;
  readonly authorDate?: string;
  readonly committerName?: string;
  readonly committerEmail?: string;
  readonly committerDate?: string;
  readonly decorations?: readonly string[];
  readonly message?: string;
}): string {
  const values = { ...DETAILS_DEFAULTS, shortOid: input.oid.slice(0, 7), ...input };
  const fields = [
    values.oid,
    values.shortOid,
    values.treeOid,
    values.parents.join(" "),
    values.authorName,
    values.authorEmail,
    values.authorDate,
    values.committerName,
    values.committerEmail,
    values.committerDate,
    values.decorations.join(", "),
    values.message,
  ].join(DETAILS_NUL);

  return `${DETAILS_RS}${COMMIT_DETAILS_FORMAT_VERSION}${DETAILS_NUL}${fields}\n`;
}

describe("buildCommitDetailsArgs", () => {
  it("builds the versioned single-record read with full decorations", () => {
    const args = buildCommitDetailsArgs("abc123");

    expect(args.slice(0, 3)).toEqual(["log", "-1", "--decorate=full"]);
    expect(args).toContain(`--format=${EXPECTED_DETAILS_FORMAT}`);
    expect(args).toContain("--end-of-options");
    expect(args.at(-1)).toBe("abc123");
    expect(args).not.toContain("--raw");
  });

  it("carries every required field atom", () => {
    for (const atom of ["%H", "%h", "%T", "%P", "%an", "%ae", "%aI", "%cn", "%ce", "%cI", "%B"]) {
      expect(EXPECTED_DETAILS_FORMAT).toContain(atom);
    }
  });
});

describe("buildCommitStatsArgs", () => {
  it("sums numstat against the first parent without a commit header", () => {
    expect(buildCommitStatsArgs("abc123")).toEqual([
      "log",
      "-1",
      "--numstat",
      "--format=",
      "--diff-merges=first-parent",
      "--end-of-options",
      "abc123",
    ]);
  });
});

describe("readCommitDetails", () => {
  it("maps every field of a normal commit", async () => {
    const { client, calls } = createClient(
      okResult(
        detailsRecord({
          oid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          shortOid: "aaaaaaa",
          treeOid: "ttttttt",
          parents: ["ppppppp"],
          decorations: ["tag: refs/tags/v1.0.0", "refs/heads/main"],
          message: "subject line\n\nbody line\n",
        }),
      ),
    );

    const result = await readCommitDetails(client, {
      cwd: "/repo",
      signal: SIGNAL,
      oid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    expect(result.ok).toBe(true);
    expect(result.failure).toBeNull();
    expect(result.details).toEqual({
      oid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      shortOid: "aaaaaaa",
      treeOid: "ttttttt",
      parents: ["ppppppp"],
      authorName: "Alice Ng",
      authorEmail: "alice@example.com",
      authorDate: "2026-10-25T09:30:00+00:00",
      committerName: "Alice Ng",
      committerEmail: "alice@example.com",
      committerDate: "2026-10-25T09:30:00+00:00",
      decorations: ["tag: refs/tags/v1.0.0", "refs/heads/main"],
      message: "subject line\n\nbody line",
    });
    expect(calls[0]?.operationClass).toBe("read");
    expect(calls[0]?.cwd).toBe("/repo");
    expect(calls[0]?.args).toContain("--decorate=full");
  });

  it("reports a root commit with no parents", async () => {
    const { client } = createClient(okResult(detailsRecord({ oid: "root001" })));

    const result = await readCommitDetails(client, {
      cwd: "/repo",
      signal: SIGNAL,
      oid: "root001",
    });

    expect(result.ok).toBe(true);
    expect(result.details?.parents).toEqual([]);
  });

  it("keeps both parents of a merge in git order", async () => {
    const { client } = createClient(
      okResult(detailsRecord({ oid: "merge01", parents: ["first01", "second1"] })),
    );

    const result = await readCommitDetails(client, {
      cwd: "/repo",
      signal: SIGNAL,
      oid: "merge01",
    });

    expect(result.details?.parents).toEqual(["first01", "second1"]);
  });

  it("keeps every parent of an octopus merge", async () => {
    const { client } = createClient(
      okResult(
        detailsRecord({
          oid: "octopus",
          parents: ["first01", "second1", "third01"],
        }),
      ),
    );

    const result = await readCommitDetails(client, {
      cwd: "/repo",
      signal: SIGNAL,
      oid: "octopus",
    });

    expect(result.details?.parents).toEqual(["first01", "second1", "third01"]);
  });

  it("keeps the committer fields when they differ from the author", async () => {
    const { client } = createClient(
      okResult(
        detailsRecord({
          oid: "rewrite",
          committerName: "Rebase Bot",
          committerEmail: "bot@example.com",
          committerDate: "2026-10-26T11:00:00+01:00",
        }),
      ),
    );

    const result = await readCommitDetails(client, {
      cwd: "/repo",
      signal: SIGNAL,
      oid: "rewrite",
    });

    expect(result.details?.authorName).toBe("Alice Ng");
    expect(result.details?.committerName).toBe("Rebase Bot");
    expect(result.details?.committerEmail).toBe("bot@example.com");
    expect(result.details?.committerDate).toBe("2026-10-26T11:00:00+01:00");
  });

  it("returns a classified failure without throwing", async () => {
    const { client } = createClient(failResult("fatal: bad revision 'missing'"));

    const result = await readCommitDetails(client, {
      cwd: "/repo",
      signal: SIGNAL,
      oid: "missing",
    });

    expect(result.ok).toBe(false);
    expect(result.details).toBeNull();
    expect(result.failure?.message).toContain("bad revision");
  });

  it("rejects a record with an unknown format version", async () => {
    const { client } = createClient(okResult(`${DETAILS_RS}2${DETAILS_NUL}broken`));

    const result = await readCommitDetails(client, {
      cwd: "/repo",
      signal: SIGNAL,
      oid: "any",
    });

    expect(result.ok).toBe(false);
    expect(result.details).toBeNull();
    expect(result.failure?.message).toContain("unknown version");
  });
});

describe("readCommitStats", () => {
  it("sums added and removed lines with first-parent merge stats", async () => {
    const { client, calls } = createClient(
      okResult(["1\t0\ta.txt", "2\t3\tb.txt", "0\t1\tc.txt"].join("\n")),
    );

    const result = await readCommitStats(client, {
      cwd: "/repo",
      signal: SIGNAL,
      oid: "merge01",
    });

    expect(result.ok).toBe(true);
    expect(result.stats).toEqual({
      filesChanged: 3,
      insertions: 3,
      deletions: 4,
      binaryFiles: 0,
      truncated: false,
    });
    expect(calls[0]?.args).toContain("--diff-merges=first-parent");
    expect(calls[0]?.args).toContain("--numstat");
    expect(calls[0]?.args).toContain("--format=");
  });

  it("counts a binary entry as a changed file with no line counts", async () => {
    const { client } = createClient(okResult(["-\t-\timage.png", "4\t1\ttext.md"].join("\n")));

    const result = await readCommitStats(client, {
      cwd: "/repo",
      signal: SIGNAL,
      oid: "binary1",
    });

    expect(result.stats).toEqual({
      filesChanged: 2,
      insertions: 4,
      deletions: 1,
      binaryFiles: 1,
      truncated: false,
    });
  });

  it("stops at the file cap and marks the result truncated", async () => {
    const lines = Array.from(
      { length: COMMIT_STATS_FILE_CAP + 1 },
      (_, index) => `1\t0\tfile-${index}.txt`,
    );
    const { client } = createClient(okResult(lines.join("\n")));

    const result = await readCommitStats(client, {
      cwd: "/repo",
      signal: SIGNAL,
      oid: "huge001",
    });

    expect(result.stats?.filesChanged).toBe(COMMIT_STATS_FILE_CAP);
    expect(result.stats?.insertions).toBe(COMMIT_STATS_FILE_CAP);
    expect(result.stats?.truncated).toBe(true);
  });

  it("returns a classified failure without throwing", async () => {
    const { client } = createClient(failResult("fatal: bad object deadbee"));

    const result = await readCommitStats(client, {
      cwd: "/repo",
      signal: SIGNAL,
      oid: "deadbee",
    });

    expect(result.ok).toBe(false);
    expect(result.stats).toBeNull();
    expect(result.failure?.message).toContain("bad object");
  });
});
