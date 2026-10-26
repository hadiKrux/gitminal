import { describe, expect, it } from "bun:test";
import { buildSearchArgs, createGraphSearch, parseSearchTerms } from "@/domain/graph/graph.search";
import type {
  GraphCommit,
  GraphPage,
  GraphRow,
  GraphSearchRequest,
} from "@/domain/graph/graph.types";

/**
 * Builds a commit row.
 *
 * @param oid - Commit OID.
 * @param parents - Parent OIDs in git order.
 * @returns The commit.
 */
function commit(oid: string, parents: readonly string[] = []): GraphCommit {
  return { oid, parents };
}

/**
 * Creates a deferred value the test resolves explicitly.
 *
 * @returns The promise plus a resolver.
 */
function defer<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolveFn: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    resolveFn = resolve;
  });

  return { promise, resolve: (value: T) => resolveFn(value) };
}

describe("parseSearchTerms", () => {
  it("splits on whitespace, keeps order, drops duplicates, and bounds the list", () => {
    expect(parseSearchTerms("  Fix   BUG fix ")).toEqual(["Fix", "BUG"]);
    expect(parseSearchTerms("")).toEqual([]);
    expect(parseSearchTerms("a b c d e f g h i j")).toHaveLength(8);
  });
});

describe("buildSearchArgs", () => {
  it("builds AND, case-insensitive, fixed-string matching over the full scope", () => {
    const args = buildSearchArgs({
      scopeArgs: ["--branches", "--remotes", "HEAD"],
      terms: ["fix", "[bug]"],
      limit: 500,
      offset: 0,
    });

    expect(args).toContain("--fixed-strings");
    expect(args).toContain("-i");
    expect(args).toContain("--all-match");
    expect(args).toContain("--max-count=500");
    expect(args).toContain("--branches");
    expect(args.filter((argument) => argument === "--grep")).toHaveLength(2);
    expect(args.some((argument) => argument.startsWith("--skip="))).toBe(false);
  });

  it("adds only the stable offset on a continuation page", () => {
    const args = buildSearchArgs({
      scopeArgs: ["--branches", "--remotes", "HEAD"],
      terms: ["fix"],
      limit: 500,
      offset: 4,
    });

    expect(args).toContain("--skip=4");
    expect(args).toContain("--branches");
    expect(args).toContain("--remotes");
    expect(args).toContain("HEAD");
  });
});

/**
 * Builds a commit with a subject used by the faithful search loader.
 *
 * @param oid - Commit OID.
 * @param subject - Commit subject.
 * @param parents - Parent OIDs in git order.
 * @returns The commit fixture.
 */
function subjectCommit(
  oid: string,
  subject: string,
  parents: readonly string[] = [],
): GraphCommit & { readonly subject: string } {
  return { oid, subject, parents };
}

/**
 * Builds a loader that models git: filter the fixed history, then skip matching commits.
 *
 * The loader walks the full history and filters by the query term before applying the offset, so a
 * non-matching parent between two matches is still traversed by the search, exactly as `git log`
 * does over the fixed scope.
 *
 * @param history - Full history in display order.
 * @param requests - Recorded requests.
 * @returns The faithful loader.
 */
function createFaithfulLoader(
  history: readonly (GraphCommit & { readonly subject: string })[],
  requests: GraphSearchRequest[],
) {
  return async (request: GraphSearchRequest): Promise<GraphPage> => {
    requests.push(request);

    const term = (request.terms[0] ?? "").toLowerCase();
    const matches = history.filter((entry) => entry.subject.toLowerCase().includes(term));
    const page = matches.slice(request.offset, request.offset + request.limit);

    return {
      commits: page.map((entry) => commit(entry.oid, entry.parents)),
      done: page.length < request.limit,
    };
  };
}

describe("createGraphSearch", () => {
  it("returns no results for an empty query", async () => {
    const search = createGraphSearch({
      scopeKey: "all",
      pageSize: 10,
      loadPage: async () => ({ commits: [commit("a")], done: false }),
    });

    const outcome = await search.search("   ");

    expect(outcome.status).toBe("empty-query");
    expect(search.getState().rows).toEqual([]);
  });

  it("pages results with a stable offset and never a frontier", async () => {
    const requests: GraphSearchRequest[] = [];
    const search = createGraphSearch({
      scopeKey: "all",
      pageSize: 2,
      loadPage: async (request) => {
        requests.push(request);

        return requests.length === 1
          ? { commits: [commit("a", ["b"]), commit("b", ["c"])], done: false }
          : { commits: [commit("c")], done: true };
      },
    });

    await search.search("fix");
    await search.loadMore();

    expect(requests[0]).toEqual({ scopeKey: "all", terms: ["fix"], offset: 0, limit: 2 });
    expect(requests[1]?.offset).toBe(2);
    expect(requests[1] !== undefined && "frontier" in requests[1]).toBe(false);
    expect(search.getState().rows.map((row) => row.oid)).toEqual(["a", "b", "c"]);
    expect(search.getState().offset).toBe(3);
    expect(search.getState().done).toBe(true);
  });

  it("returns every match behind a non-matching parent with a faithful loader", async () => {
    const history = [
      subjectCommit("c10", "plain 10", ["c9"]),
      subjectCommit("c9", "plain 9", ["c8"]),
      subjectCommit("c8", "TARGET commit 8", ["c7"]),
      subjectCommit("c7", "plain 7", ["c6"]),
      subjectCommit("c6", "plain 6", ["c5"]),
      subjectCommit("c5", "plain 5", ["c4"]),
      subjectCommit("c4", "plain 4", ["c3"]),
      subjectCommit("c3", "TARGET commit 3", ["c2"]),
      subjectCommit("c2", "plain 2", ["c1"]),
      subjectCommit("c1", "TARGET commit 1"),
    ];
    const requests: GraphSearchRequest[] = [];
    const search = createGraphSearch({
      scopeKey: "all",
      pageSize: 1,
      loadPage: createFaithfulLoader(history, requests),
    });

    let outcome = await search.search("TARGET");

    while (!search.getState().done) {
      outcome = await search.loadMore();

      if (outcome.status === "error") {
        break;
      }
    }

    expect(search.getState().rows.map((row) => row.oid)).toEqual(["c8", "c3", "c1"]);
    expect(search.getState().done).toBe(true);
    expect(requests.map((request) => request.offset)).toEqual([0, 1, 2, 3]);
  });

  it("covers matches reachable only from another branch in the full scope", async () => {
    const history = [
      subjectCommit("merge1", "plain merge", ["main2", "side2"]),
      subjectCommit("main2", "TARGET main", ["base"]),
      subjectCommit("side2", "TARGET side deep", ["side1"]),
      subjectCommit("side1", "plain side", ["base"]),
      subjectCommit("base", "plain base"),
    ];
    const requests: GraphSearchRequest[] = [];
    const search = createGraphSearch({
      scopeKey: "all",
      pageSize: 1,
      loadPage: createFaithfulLoader(history, requests),
    });

    await search.search("TARGET");

    while (!search.getState().done) {
      await search.loadMore();
    }

    expect(search.getState().rows.map((row) => row.oid)).toEqual(["main2", "side2"]);
  });

  it("resets the offset when a new query starts", async () => {
    const requests: GraphSearchRequest[] = [];
    const search = createGraphSearch({
      scopeKey: "all",
      pageSize: 2,
      loadPage: async (request) => {
        requests.push(request);

        return { commits: [commit(`match-${requests.length}`)], done: false };
      },
    });

    await search.search("one");
    await search.loadMore();
    await search.search("two");

    expect(requests.at(-1)?.offset).toBe(0);
  });

  it("coalesces loadMore calls into one in-flight request", async () => {
    const pending = defer<GraphPage>();
    let calls = 0;
    const search = createGraphSearch({
      scopeKey: "all",
      pageSize: 2,
      loadPage: async () => {
        calls += 1;

        return await pending.promise;
      },
    });

    const first = search.search("fix");
    const second = search.loadMore();

    expect(calls).toBe(1);

    pending.resolve({ commits: [commit("a")], done: false });

    expect((await first).status).toBe("appended");
    expect((await second).status).toBe("appended");
  });

  it("discards a stale query result when a newer query starts", async () => {
    const first = defer<GraphPage>();
    const second = defer<GraphPage>();
    let calls = 0;
    const search = createGraphSearch({
      scopeKey: "all",
      pageSize: 10,
      loadPage: async () => {
        calls += 1;

        return await (calls === 1 ? first.promise : second.promise);
      },
    });

    const older = search.search("old");
    const newer = search.search("new");

    first.resolve({ commits: [commit("old-match")], done: false });
    second.resolve({ commits: [commit("new-match")], done: false });

    expect((await older).status).toBe("stale");
    expect((await newer).status).toBe("appended");
    expect(search.getState().query).toBe("new");
    expect(search.getState().rows.map((row) => row.oid)).toEqual(["new-match"]);
  });

  it("rejects a repeated result OID and ends only when git reports exhaustion", async () => {
    let page = 0;
    const search = createGraphSearch({
      scopeKey: "all",
      pageSize: 2,
      loadPage: async () => {
        page += 1;

        return page === 1
          ? { commits: [commit("a"), commit("b")], done: false }
          : { commits: [commit("b")], done: true };
      },
    });

    await search.search("fix");
    await search.loadMore();

    expect(search.getState().rows.map((row) => row.oid)).toEqual(["a", "b"]);
    expect(search.getState().done).toBe(true);
  });

  it("recovers older matches past a repeated page after two inserted matches shift the result set", async () => {
    let history = [
      subjectCommit("m7", "TARGET 7", ["m6"]),
      subjectCommit("m6", "plain 6", ["m5"]),
      subjectCommit("m5", "TARGET 5", ["m4"]),
      subjectCommit("m4", "plain 4", ["m3"]),
      subjectCommit("m3", "plain 3", ["m2"]),
      subjectCommit("m2", "TARGET 2", ["m1"]),
      subjectCommit("m1", "plain 1"),
    ];
    const requests: GraphSearchRequest[] = [];
    const search = createGraphSearch({
      scopeKey: "all",
      pageSize: 2,
      loadPage: async (request): Promise<GraphPage> => {
        requests.push(request);

        const term = (request.terms[0] ?? "").toLowerCase();
        const matches = history.filter((entry) => entry.subject.toLowerCase().includes(term));
        const page = matches.slice(request.offset, request.offset + request.limit);

        return {
          commits: page.map((entry) => commit(entry.oid, entry.parents)),
          done: page.length < request.limit,
        };
      },
    });

    const first = await search.search("TARGET");

    expect(first.status).toBe("appended");
    expect(search.getState().rows.map((row) => row.oid)).toEqual(["m7", "m5"]);

    history = [
      subjectCommit("m9", "TARGET new 9", ["m7"]),
      subjectCommit("m8", "TARGET new 8", ["m9"]),
      ...history,
    ];

    // Two matches inserted above the loaded offset shift the page. The stable offset recovers the
    // older match m2, but the inserted matches m9 and m8 are skipped for the rest of this query.
    const outcomes = [await search.loadMore()];

    while (!search.getState().done && outcomes.length < 10) {
      outcomes.push(await search.loadMore());
    }

    expect(search.getState().rows.map((row) => row.oid)).toEqual(["m7", "m5", "m2"]);
    expect(new Set(search.getState().rows.map((row) => row.oid)).size).toBe(3);
    expect(requests.map((request) => request.offset)).toEqual([0, 2, 4]);
    expect(outcomes.slice(0, -1).every((outcome) => outcome.status !== "done")).toBeTrue();
    expect(outcomes.at(-1)?.status).toBe("done");
    expect(search.getState().done).toBeTrue();
  });

  it("returns an error outcome without merging results", async () => {
    const search = createGraphSearch({
      scopeKey: "all",
      pageSize: 10,
      loadPage: async () => {
        throw new Error("search failed");
      },
    });

    const outcome = await search.search("fix");

    expect(outcome.status).toBe("error");
    expect(search.getState().rows).toEqual([]);
  });

  it("keeps the full display row payload returned by the loader", async () => {
    const row: GraphRow = {
      oid: "match01",
      parents: ["parent1"],
      authorName: "Probe User",
      authorEmail: "probe@example.com",
      authorDate: "2026-10-25T20:09:30-06:00",
      committerTimestamp: 1_792_980_570,
      decorations: ["HEAD -> refs/heads/main"],
      subject: "fix the bug",
      body: "details in the body",
      fileCount: 2,
      additions: 7,
      deletions: 3,
      files: [
        {
          path: "src/app.ts",
          oldPath: null,
          status: "modified",
          additions: 7,
          deletions: 3,
          binary: false,
        },
      ],
    };
    const search = createGraphSearch({
      scopeKey: "all",
      pageSize: 10,
      loadPage: async () => ({
        commits: [{ oid: row.oid, parents: row.parents, row }],
        done: true,
      }),
    });

    await search.search("fix bug");

    expect(search.getState().rows[0]?.row).toEqual(row);
  });
});
