import { describe, expect, it } from "bun:test";
import {
  GRAPH_LOG_FIELD_SEPARATOR,
  GRAPH_LOG_FORMAT_VERSION,
  GRAPH_LOG_RECORD_SEPARATOR,
} from "@/domain/git/git.log";
import { parseLogRecords } from "@/domain/git/parsers/parse.log";

/** NUL field separator of one record. */
const NUL = GRAPH_LOG_FIELD_SEPARATOR;

/** Record separator that starts and ends one record. */
const RS = GRAPH_LOG_RECORD_SEPARATOR;

/** Record fields used by the fixture builder. */
interface RecordInput {
  readonly oid: string;
  readonly parents: readonly string[];
  readonly authorName: string;
  readonly authorEmail: string;
  readonly authorDate: string;
  readonly committerTimestamp: string;
  readonly decorations: string;
  readonly subject: string;
  readonly body: string;
  readonly raw: readonly string[];
  readonly numstat: readonly string[];
}

/**
 * Builds one version-1 record exactly as `git log -z --raw --numstat` emits it.
 *
 * @param input - Record fields and file-block tokens.
 * @returns The raw record bytes.
 */
function record(input: RecordInput): string {
  const fields = [
    input.oid,
    input.parents.join(" "),
    input.authorName,
    input.authorEmail,
    input.authorDate,
    input.committerTimestamp,
    input.decorations,
    input.subject,
    input.body,
  ].join(NUL);
  const header = `${RS}${GRAPH_LOG_FORMAT_VERSION}${NUL}${fields}${RS}`;
  const fileBlock =
    input.raw.length + input.numstat.length === 0
      ? NUL
      : `${NUL}\n${input.raw.join("")}${input.numstat.join("")}`;

  return header + fileBlock;
}

/**
 * Builds one raw entry.
 *
 * @param status - Raw status such as `M` or `R100`.
 * @param path - New path.
 * @param oldPath - Previous path for a rename or copy.
 * @returns The raw entry bytes.
 */
function raw(status: string, path: string, oldPath?: string): string {
  const paths = oldPath === undefined ? `${path}${NUL}` : `${oldPath}${NUL}${path}${NUL}`;

  return `:100644 100644 aaaaaaa bbbbbbb ${status}${NUL}${paths}`;
}

/**
 * Builds one numstat entry.
 *
 * @param additions - Added-lines column.
 * @param deletions - Removed-lines column.
 * @param path - New path, or a tuple for a rename or copy.
 * @returns The numstat entry bytes.
 */
function numstat(
  additions: string,
  deletions: string,
  path: string | { readonly oldPath: string; readonly path: string },
): string {
  if (typeof path === "string") {
    return `${additions}\t${deletions}\t${path}${NUL}`;
  }

  return `${additions}\t${deletions}\t${NUL}${path.oldPath}${NUL}${path.path}${NUL}`;
}

/** Fields every fixture record starts from before a test overrides them. */
const BASE: Omit<RecordInput, "oid" | "parents" | "subject"> = {
  authorName: "Probe User",
  authorEmail: "probe@example.com",
  authorDate: "2026-10-25T20:09:30-06:00",
  committerTimestamp: "1792980570",
  decorations: "",
  body: "",
  raw: [],
  numstat: [],
};

/**
 * Builds the recorded page used by the parsing tests.
 *
 * The page contains a merge with a first-parent stat, an octopus merge, a rename with a body that
 * contains a record separator, and a root commit with a text and a binary file.
 *
 * @returns The captured version-1 log output.
 */
function recordedPage(): string {
  return [
    record({
      ...BASE,
      oid: "merge0001",
      parents: ["parent01", "parent02"],
      decorations: "HEAD -> refs/heads/main, refs/remotes/origin/main",
      subject: "merge side",
      body: "merge body line one\nmerge body line two\n",
      raw: [raw("A", "side.txt")],
      numstat: [numstat("4", "0", "side.txt")],
    }),
    record({
      ...BASE,
      oid: "octopus01",
      parents: ["parent01", "parent02", "parent03"],
      decorations: "tag: refs/tags/v1.0.0",
      subject: "octopus merge",
      raw: [raw("M", "shared.txt")],
      numstat: [numstat("1", "2", "shared.txt")],
    }),
    record({
      ...BASE,
      oid: "rename001",
      parents: ["parent02"],
      subject: "rename a file",
      body: `body before${RS}body after\n`,
      raw: [raw("R100", "renamed.txt", "original.txt"), raw("M", "binary.bin")],
      numstat: [
        numstat("3", "1", { oldPath: "original.txt", path: "renamed.txt" }),
        numstat("-", "-", "binary.bin"),
      ],
    }),
    record({
      ...BASE,
      oid: "root00001",
      parents: [],
      authorName: "Root Author",
      subject: "root commit",
      raw: [raw("A", "a.txt"), raw("A", "b.bin")],
      numstat: [numstat("2", "0", "a.txt"), numstat("-", "-", "b.bin")],
    }),
  ].join("");
}

describe("parseLogRecords", () => {
  it("parses the order, parents, author, decorations, subject, and multiline body", () => {
    const parsed = parseLogRecords(recordedPage());

    expect(parsed.ok).toBe(true);

    if (!parsed.ok) {
      return;
    }

    expect(parsed.rows.map((row) => row.oid)).toEqual([
      "merge0001",
      "octopus01",
      "rename001",
      "root00001",
    ]);
    expect(parsed.rows[0]).toMatchObject({
      parents: ["parent01", "parent02"],
      decorations: ["HEAD -> refs/heads/main", "refs/remotes/origin/main"],
      authorName: "Probe User",
      authorEmail: "probe@example.com",
      authorDate: "2026-10-25T20:09:30-06:00",
      committerTimestamp: 1_792_980_570,
      subject: "merge side",
      body: "merge body line one\nmerge body line two",
    });
  });

  it("does not treat a path token ending in the record-start bytes as a new record", () => {
    const pathologicalPath = `${RS}1`;
    const parsed = parseLogRecords(
      [
        record({
          ...BASE,
          oid: "path0001",
          parents: [],
          subject: "pathological path",
          raw: [raw("A", pathologicalPath)],
          numstat: [numstat("1", "0", pathologicalPath)],
        }),
        record({
          ...BASE,
          oid: "next0001",
          parents: ["path0001"],
          subject: "next commit",
          raw: [raw("M", "b.txt")],
          numstat: [numstat("1", "1", "b.txt")],
        }),
      ].join(""),
    );

    expect(parsed.ok).toBe(true);

    if (parsed.ok) {
      expect(parsed.rows.map((row) => row.oid)).toEqual(["path0001", "next0001"]);
      expect(parsed.rows[0]?.files[0]?.path).toBe(pathologicalPath);
    }
  });

  it("keeps a record separator inside a message without splitting the record", () => {
    const parsed = parseLogRecords(recordedPage());

    expect(parsed.ok).toBe(true);

    if (parsed.ok) {
      expect(parsed.rows[2]?.body).toBe(`body before${RS}body after`);
    }
  });

  it("parses an octopus merge with every parent and a tag decoration", () => {
    const parsed = parseLogRecords(recordedPage());

    expect(parsed.ok).toBe(true);

    if (parsed.ok) {
      expect(parsed.rows[1]?.parents).toHaveLength(3);
      expect(parsed.rows[1]?.decorations).toEqual(["tag: refs/tags/v1.0.0"]);
      expect(parsed.rows[1]?.fileCount).toBe(1);
    }
  });

  it("joins raw statuses and numstat counts by path for a first-parent merge", () => {
    const parsed = parseLogRecords(recordedPage());

    expect(parsed.ok).toBe(true);

    if (!parsed.ok) {
      return;
    }

    const merge = parsed.rows[0];

    expect(merge?.fileCount).toBe(1);
    expect(merge?.additions).toBe(4);
    expect(merge?.deletions).toBe(0);
    expect(merge?.files).toEqual([
      {
        path: "side.txt",
        oldPath: null,
        status: "added",
        additions: 4,
        deletions: 0,
        binary: false,
      },
    ]);
  });

  it("keeps rename old and new paths and binary counts", () => {
    const parsed = parseLogRecords(recordedPage());

    expect(parsed.ok).toBe(true);

    if (!parsed.ok) {
      return;
    }

    const rename = parsed.rows[2];

    expect(rename?.fileCount).toBe(2);
    expect(rename?.files[0]).toEqual({
      path: "renamed.txt",
      oldPath: "original.txt",
      status: "renamed",
      additions: 3,
      deletions: 1,
      binary: false,
    });
    expect(rename?.files[1]).toEqual({
      path: "binary.bin",
      oldPath: null,
      status: "modified",
      additions: null,
      deletions: null,
      binary: true,
    });
    expect(rename?.additions).toBe(3);
    expect(rename?.deletions).toBe(1);
  });

  it("parses a root commit with no parents and its file list", () => {
    const parsed = parseLogRecords(recordedPage());

    expect(parsed.ok).toBe(true);

    if (!parsed.ok) {
      return;
    }

    const root = parsed.rows[3];

    expect(root?.parents).toEqual([]);
    expect(root?.fileCount).toBe(2);
    expect(root?.additions).toBe(2);
    expect(root?.deletions).toBe(0);
    expect(root?.files.map((file) => file.path)).toEqual(["a.txt", "b.bin"]);
    expect(root?.files[1]?.binary).toBe(true);
  });

  it("returns an empty page for empty output", () => {
    expect(parseLogRecords("")).toEqual({ ok: true, rows: [] });
  });

  it("rejects a missing version", () => {
    const parsed = parseLogRecords(`abc123${NUL}${NUL}author`);

    expect(parsed.ok).toBe(false);

    if (!parsed.ok) {
      expect(parsed.error.kind).toBe("missing-version");
    }
  });

  it("rejects an unknown version", () => {
    const parsed = parseLogRecords(`${RS}2${NUL}abc123${RS}${NUL}`);

    expect(parsed.ok).toBe(false);

    if (!parsed.ok) {
      expect(parsed.error.kind).toBe("unknown-version");
      expect(parsed.error.message).toContain("2");
    }
  });

  it("rejects a record with the wrong field count", () => {
    const parsed = parseLogRecords(`${RS}1${NUL}abc123${NUL}parent01${RS}${NUL}`);

    expect(parsed.ok).toBe(false);

    if (!parsed.ok) {
      expect(parsed.error.kind).toBe("field-count");
    }
  });

  it("rejects a page that repeats an OID", () => {
    const repeated = record({ ...BASE, oid: "same0001", parents: [], subject: "one" });
    const parsed = parseLogRecords(repeated + repeated);

    expect(parsed.ok).toBe(false);

    if (!parsed.ok) {
      expect(parsed.error.kind).toBe("duplicate-oid");
    }
  });
});
