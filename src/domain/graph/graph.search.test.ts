import { describe, expect, it } from "bun:test";
import { buildSearchArgs, createGraphSearch, parseSearchTerms } from "@/domain/graph/graph.search";
import type { GraphCommit, GraphPage, GraphSearchRequest } from "@/domain/graph/graph.types";

/**
 * Builds a commit row.
 *
 * @param oid - Commit OID.
 * @returns The commit.
 */
function commit(oid: string): GraphCommit {
  return { oid, parents: [] };
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
  it("builds AND, case-insensitive, fixed-string matching with a bounded page", () => {
    const args = buildSearchArgs({
      scopeArgs: ["--branches", "--remotes", "HEAD"],
      terms: ["fix", "[bug]"],
      limit: 500,
      frontier: ["abc123"],
    });

    expect(args).toContain("--fixed-strings");
    expect(args).toContain("-i");
    expect(args).toContain("--all-match");
    expect(args).toContain("--max-count=500");
    expect(args).toContain("--branches");
    expect(args).toContain("abc123");
    expect(args.filter((argument) => argument === "--grep")).toHaveLength(2);
    expect(args).not.toContain("--skip");
  });
});

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

  it("pages results with a cursor and no offset", async () => {
    const requests: GraphSearchRequest[] = [];
    const search = createGraphSearch({
      scopeKey: "all",
      pageSize: 2,
      loadPage: async (request) => {
        requests.push(request);

        return requests.length === 1
          ? { commits: [commit("a"), commit("b")], done: false }
          : { commits: [commit("c")], done: true };
      },
    });

    await search.search("fix");
    await search.loadMore();

    expect(requests[0]).toEqual({ scopeKey: "all", terms: ["fix"], frontier: [], limit: 2 });
    expect(requests[1]?.frontier).toEqual(["b"]);
    expect(requests[1] !== undefined && "skip" in requests[1]).toBe(false);
    expect(search.getState().rows.map((row) => row.oid)).toEqual(["a", "b", "c"]);
    expect(search.getState().done).toBe(true);
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

  it("rejects a repeated result OID", async () => {
    let page = 0;
    const search = createGraphSearch({
      scopeKey: "all",
      pageSize: 2,
      loadPage: async () => {
        page += 1;

        return page === 1
          ? { commits: [commit("a"), commit("b")], done: false }
          : { commits: [commit("b")], done: false };
      },
    });

    await search.search("fix");
    await search.loadMore();

    expect(search.getState().rows.map((row) => row.oid)).toEqual(["a", "b"]);
    expect(search.getState().done).toBe(true);
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
});
