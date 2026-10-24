import { describe, expect, it } from "bun:test";
import {
  buildNextPageRequest,
  computeFrontier,
  createEmptyWindow,
  createGraphPaginator,
} from "@/domain/graph/graph.paginate";
import type { GraphCommit, GraphPage, GraphPageRequest } from "@/domain/graph/graph.types";

/**
 * Builds a commit row.
 *
 * @param oid - Commit OID.
 * @param parents - Parent OIDs.
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

describe("graph.paginate pure helpers", () => {
  it("computes the frontier from unemitted parents in first-seen order", () => {
    const rows = [commit("a", ["b", "c"]), commit("b", ["d"]), commit("c", ["d"])];

    expect(computeFrontier(rows)).toEqual(["d"]);
  });

  it("builds a request from the cursor without an offset", () => {
    const window = {
      ...createEmptyWindow("all"),
      rows: [commit("a", ["b"])],
      frontier: ["b"],
      oldestOid: "a",
    };
    const request = buildNextPageRequest(window, 500);

    expect(request).toEqual({ scopeKey: "all", frontier: ["b"], limit: 500 });
    expect(request !== null && "skip" in request).toBe(false);
  });

  it("returns no request when history is exhausted", () => {
    expect(buildNextPageRequest({ ...createEmptyWindow("all"), done: true }, 10)).toBeNull();
  });
});

describe("createGraphPaginator", () => {
  it("bounds the initial page by the configured page size", async () => {
    const requests: GraphPageRequest[] = [];
    const paginator = createGraphPaginator({
      pageSize: 3,
      initialScope: "all",
      loadPage: async (request) => {
        requests.push(request);

        return { commits: [commit("a")], done: false };
      },
    });

    await paginator.loadInitial();

    expect(requests).toEqual([{ scopeKey: "all", frontier: [], limit: 3 }]);
    expect(paginator.getState().pagesLoaded).toBe(1);
  });

  it("keeps one in-flight request and coalesces repeated loads", async () => {
    const pending = defer<GraphPage>();
    let calls = 0;
    const paginator = createGraphPaginator({
      pageSize: 2,
      initialScope: "all",
      loadPage: async () => {
        calls += 1;

        return await pending.promise;
      },
    });

    const first = paginator.loadOlder();
    const second = paginator.loadOlder();

    expect(calls).toBe(1);

    pending.resolve({ commits: [commit("a", ["b"])], done: false });

    const [left, right] = await Promise.all([first, second]);

    expect(left.status).toBe("appended");
    expect(right.status).toBe("appended");
    expect(calls).toBe(1);
  });

  it("continues from the oldest frontier and rejects duplicate OIDs", async () => {
    const requests: GraphPageRequest[] = [];
    let page = 0;
    const paginator = createGraphPaginator({
      pageSize: 2,
      initialScope: "all",
      loadPage: async (request) => {
        requests.push(request);
        page += 1;

        if (page === 1) {
          return { commits: [commit("a", ["b"]), commit("b", ["c"])], done: false };
        }

        return { commits: [commit("b", ["c"]), commit("c")], done: false };
      },
    });

    await paginator.loadInitial();
    await paginator.loadOlder();

    expect(requests[1]?.frontier).toEqual(["c"]);
    expect(paginator.getState().rows.map((row) => row.oid)).toEqual(["a", "b", "c"]);
    expect(paginator.getState().oldestOid).toBe("c");
  });

  it("trims the retained window while keeping the next-page cursor monotonic", async () => {
    let page = 0;
    const requests: GraphPageRequest[] = [];
    const paginator = createGraphPaginator({
      pageSize: 2,
      maxRetainedPages: 1,
      initialScope: "all",
      loadPage: async (request) => {
        requests.push(request);
        page += 1;

        if (page === 1) {
          return { commits: [commit("a", ["b"]), commit("b", ["c"])], done: false };
        }

        if (page === 2) {
          return { commits: [commit("c", ["d"]), commit("d", ["e"])], done: false };
        }

        return { commits: [commit("e")], done: true };
      },
    });

    await paginator.loadInitial();
    await paginator.loadOlder();
    await paginator.loadOlder();

    const state = paginator.getState();

    expect(state.rows).toHaveLength(2);
    expect(state.rows.map((row) => row.oid)).toEqual(["d", "e"]);
    expect(state.frontier).toEqual([]);
    expect(state.oldestOid).toBe("e");
    expect(state.done).toBe(true);
    expect(requests.at(-1)?.frontier).toEqual(["e"]);
  });

  it("discards a result whose generation no longer matches", async () => {
    const pending = defer<GraphPage>();
    const paginator = createGraphPaginator({
      pageSize: 2,
      initialScope: "all",
      loadPage: async () => await pending.promise,
    });

    const loading = paginator.loadOlder();

    paginator.reset("local");
    pending.resolve({ commits: [commit("a")], done: false });

    const outcome = await loading;

    expect(outcome.status).toBe("stale");
    expect(paginator.getState().rows).toEqual([]);
    expect(paginator.getState().scopeKey).toBe("local");
  });

  it("marks end of history when the loader reports it", async () => {
    const paginator = createGraphPaginator({
      pageSize: 2,
      initialScope: "current",
      loadPage: async () => ({ commits: [commit("a")], done: true }),
    });

    const outcome = await paginator.loadInitial();

    expect(outcome.status).toBe("done");
    expect(paginator.getState().done).toBe(true);
    expect(await paginator.loadOlder()).toMatchObject({ status: "done" });
  });

  it("returns an error outcome without merging a failed page", async () => {
    const paginator = createGraphPaginator({
      pageSize: 2,
      initialScope: "all",
      loadPage: async () => {
        throw new Error("log failed");
      },
    });

    const outcome = await paginator.loadInitial();

    expect(outcome.status).toBe("error");
    expect(paginator.getState().pagesLoaded).toBe(0);
  });

  it("loads a target OID within the ensure bound", async () => {
    let page = 0;
    const paginator = createGraphPaginator({
      pageSize: 1,
      initialScope: "all",
      loadPage: async () => {
        page += 1;

        return page < 3
          ? { commits: [commit(`c${page}`, [`c${page + 1}`])], done: false }
          : { commits: [commit("target")], done: false };
      },
    });

    expect(await paginator.ensureLoaded("target")).toBe("loaded");
    expect(page).toBe(3);
  });

  it("reports notFound at the end of history and exceeded at the page bound", async () => {
    const short = createGraphPaginator({
      pageSize: 1,
      initialScope: "all",
      loadPage: async () => ({ commits: [commit("a")], done: true }),
    });

    expect(await short.ensureLoaded("missing")).toBe("notFound");

    let boundedPage = 0;
    const bounded = createGraphPaginator({
      pageSize: 1,
      ensureMaxPages: 2,
      initialScope: "all",
      loadPage: async () => {
        boundedPage += 1;

        return { commits: [commit(`b${boundedPage}`, ["never"])], done: false };
      },
    });

    expect(await bounded.ensureLoaded("missing")).toBe("exceeded");
  });

  it("reports cancelled when the signal aborts", async () => {
    const controller = new AbortController();
    const paginator = createGraphPaginator({
      pageSize: 1,
      initialScope: "all",
      loadPage: async () => ({ commits: [commit("a", ["b"])], done: false }),
    });

    controller.abort();

    expect(await paginator.ensureLoaded("missing", controller.signal)).toBe("cancelled");
  });
});
