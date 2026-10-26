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

/**
 * Reports whether one commit is reachable from any positive revision.
 *
 * @param parentsByOid - Parent list per commit.
 * @param frontier - Positive revisions of a continuation request.
 * @param oid - Candidate commit.
 * @returns True when the candidate is in the walk's reachable set.
 */
function reachableFrom(
  parentsByOid: Readonly<Record<string, readonly string[]>>,
  frontier: readonly string[],
  oid: string,
): boolean {
  const visited = new Set<string>();
  const stack = [...frontier];

  while (stack.length > 0) {
    const current = stack.pop();

    if (current === undefined || visited.has(current)) {
      continue;
    }

    visited.add(current);
    stack.push(...(parentsByOid[current] ?? []));
  }

  return visited.has(oid);
}

describe("graph.paginate pure helpers", () => {
  it("computes the frontier from unemitted parents in first-seen order", () => {
    const rows = [commit("a", ["b", "c"]), commit("b", ["d"]), commit("c", ["d"])];

    expect(computeFrontier(rows)).toEqual(["d"]);
  });

  it("builds a continuation request from the cursor without an offset", () => {
    const window = {
      ...createEmptyWindow("all"),
      rows: [commit("a", ["b"])],
      pagesLoaded: 1,
      frontier: ["b"],
      oldestOid: "a",
    };
    const request = buildNextPageRequest(window, 500);

    expect(request).toEqual({ scopeKey: "all", frontier: ["b"], limit: 500 });
    expect(request !== null && "skip" in request).toBe(false);
  });

  it("passes an empty frontier on the first page even when tips are seeded", () => {
    const window = {
      ...createEmptyWindow("all", ["tip01", "tip02", "tip01"]),
    };

    expect(window.frontier).toEqual(["tip01", "tip02"]);
    expect(buildNextPageRequest(window, 2)).toEqual({
      scopeKey: "all",
      frontier: [],
      limit: 2,
    });
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

  it("seeds the initial window and every reset with the current scope tips", async () => {
    let tips: readonly string[] = ["tip-a"];
    const requests: GraphPageRequest[] = [];
    const paginator = createGraphPaginator({
      pageSize: 2,
      initialScope: "all",
      listScopeTips: () => tips,
      loadPage: async (request) => {
        requests.push(request);

        return { commits: [commit(`page-${requests.length}`)], done: false };
      },
    });

    expect(paginator.getState().frontier).toEqual(["tip-a"]);

    await paginator.loadInitial();

    expect(requests[0]?.frontier).toEqual([]);
    expect(paginator.getState().frontier).toContain("tip-a");

    tips = ["tip-b"];
    paginator.reset("local");

    expect(paginator.getState().scopeKey).toBe("local");
    expect(paginator.getState().frontier).toEqual(["tip-b"]);
  });

  it("loads a tip outside the first page exactly once with a faithful loader", async () => {
    const parentsByOid: Readonly<Record<string, readonly string[]>> = {
      main5: ["main4"],
      main4: ["main3"],
      main3: ["main2"],
      main2: ["main1"],
      main1: ["root"],
      "old-tip": ["root"],
      root: [],
    };
    const order = ["main5", "main4", "main3", "main2", "main1", "old-tip", "root"];
    const requests: GraphPageRequest[] = [];
    const paginator = createGraphPaginator({
      pageSize: 2,
      initialScope: "all",
      listScopeTips: () => ["main5", "old-tip"],
      loadPage: async (request) => {
        requests.push(request);

        const candidates =
          request.frontier.length === 0
            ? order
            : order.filter((oid) => reachableFrom(parentsByOid, request.frontier, oid));
        const page = candidates.slice(0, request.limit);

        return {
          commits: page.map((oid) => commit(oid, parentsByOid[oid] ?? [])),
          done: page.length < request.limit,
        };
      },
    });

    const outcomes = [await paginator.loadInitial()];

    while (!paginator.getState().done && outcomes.length < 10) {
      outcomes.push(await paginator.loadOlder());
    }

    const rows = paginator.getState().rows.map((row) => row.oid);

    expect(requests[0]?.frontier).toEqual([]);
    expect(requests[1]?.frontier).toContain("old-tip");
    expect(rows.filter((oid) => oid === "old-tip")).toHaveLength(1);
    expect(new Set(rows).size).toBe(order.length);
    expect([...rows].sort()).toEqual([...order].sort());
    expect(paginator.getState().done).toBeTrue();
    expect(outcomes.slice(0, -1).every((outcome) => outcome.status !== "done")).toBeTrue();
    expect(outcomes.at(-1)?.status).toBe("done");
  });

  it("does not re-add a tip released by window trimming", async () => {
    const requests: GraphPageRequest[] = [];
    const paginator = createGraphPaginator({
      pageSize: 2,
      maxRetainedPages: 1,
      initialScope: "all",
      listScopeTips: () => ["tip01"],
      loadPage: async (request) => {
        requests.push(request);

        if (requests.length === 1) {
          return { commits: [commit("tip01", ["p1"]), commit("p1", ["p2"])], done: false };
        }

        if (requests.length === 2) {
          return { commits: [commit("p2", ["p3"]), commit("p3", ["p4"])], done: false };
        }

        return { commits: [commit("p4", ["p5"])], done: true };
      },
    });

    await paginator.loadInitial();
    await paginator.loadOlder();

    expect(paginator.getState().rows.map((row) => row.oid)).toEqual(["p2", "p3"]);

    await paginator.loadOlder();

    expect(requests[2]?.frontier).toEqual(["p4"]);
    expect(requests[2]?.frontier).not.toContain("tip01");
  });

  it("does not fold a late tip whose parent was already emitted", async () => {
    const parentsByOid: Readonly<Record<string, readonly string[]>> = {
      main5: ["main4"],
      main4: ["main3"],
      main3: ["main2"],
      main2: ["main1"],
      main1: [],
      late: ["main4"],
    };
    const order = ["main5", "main4", "main3", "main2", "main1"];
    let tips: readonly string[] = ["main5"];
    const requests: GraphPageRequest[] = [];
    const paginator = createGraphPaginator({
      pageSize: 2,
      initialScope: "all",
      listScopeTips: () => tips,
      loadPage: async (request) => {
        requests.push(request);

        const candidates =
          request.frontier.length === 0
            ? order
            : order.filter((oid) => reachableFrom(parentsByOid, request.frontier, oid));
        const page = candidates.slice(0, request.limit);

        return {
          commits: page.map((oid) => commit(oid, parentsByOid[oid] ?? [])),
          done: page.length < request.limit,
        };
      },
    });

    await paginator.loadInitial();

    expect(paginator.getState().rows.map((row) => row.oid)).toEqual(["main5", "main4"]);

    tips = ["main5", "late"];

    await paginator.loadOlder();
    await paginator.loadOlder();

    const rows = paginator.getState().rows.map((row) => row.oid);

    expect(requests[1]?.frontier).toEqual(["main3"]);
    expect(requests[1]?.frontier).not.toContain("late");
    expect(rows).toEqual(["main5", "main4", "main3", "main2", "main1"]);
    expect(rows).not.toContain("late");
    expect(paginator.getState().done).toBeTrue();
  });

  it("filters emitted rows and emitted parents out of a poisoned page after trimming", async () => {
    const requests: GraphPageRequest[] = [];
    let page = 0;
    const paginator = createGraphPaginator({
      pageSize: 1,
      maxRetainedPages: 1,
      initialScope: "all",
      listScopeTips: () => ["main5"],
      loadPage: async (request) => {
        requests.push(request);
        page += 1;

        if (page === 1) {
          return {
            commits: [commit("main5", ["main4"]), commit("main4", ["main3"])],
            done: false,
          };
        }

        if (page === 2) {
          return {
            commits: [commit("late", ["main4"]), commit("main4", ["main3"])],
            done: false,
          };
        }

        return {
          commits: [commit("main3", ["main2"]), commit("main2", ["main1"])],
          done: false,
        };
      },
    });

    await paginator.loadInitial();
    await paginator.loadOlder();

    const state = paginator.getState();

    expect(state.rows.map((row) => row.oid)).toEqual(["late"]);
    expect(state.frontier).toEqual(["main3"]);
    expect(state.frontier).not.toContain("main4");
    expect(requests[1]?.frontier).toEqual(["main3"]);

    await paginator.loadOlder();

    expect(paginator.getState().rows.map((row) => row.oid)).toEqual(["main2"]);
    expect(paginator.getState().frontier).toEqual(["main1"]);
    expect(paginator.getState().done).toBeFalse();
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

  it("marks done when a page leaves an empty frontier", async () => {
    const requests: GraphPageRequest[] = [];
    const paginator = createGraphPaginator({
      pageSize: 2,
      initialScope: "all",
      loadPage: async (request) => {
        requests.push(request);

        return { commits: [commit("root01", ["root02"]), commit("root02")], done: false };
      },
    });

    const outcome = await paginator.loadInitial();

    expect(outcome.status).toBe("done");
    expect(paginator.getState().frontier).toEqual([]);
    expect(paginator.getState().done).toBeTrue();
    expect(buildNextPageRequest(paginator.getState(), 2)).toBeNull();
    expect(await paginator.loadOlder()).toMatchObject({ status: "done" });
    expect(requests).toHaveLength(1);
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

  it("reports error when a page read fails instead of calling it cancelled", async () => {
    const paginator = createGraphPaginator({
      pageSize: 1,
      initialScope: "all",
      loadPage: async () => {
        throw new Error("log failed");
      },
    });

    expect(await paginator.ensureLoaded("missing")).toBe("error");
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

  it("restores a captured checkpoint and discards a request that started before the rollback", async () => {
    const pending = defer<GraphPage>();
    let call = 0;
    const paginator = createGraphPaginator({
      pageSize: 2,
      initialScope: "all",
      loadPage: async () => {
        call += 1;

        if (call === 1) {
          return { commits: [commit("a", ["b"]), commit("b", ["c"])], done: false };
        }

        return await pending.promise;
      },
    });

    await paginator.loadInitial();

    const captured = paginator.capture();
    const inFlight = paginator.loadOlder();

    paginator.restore(captured);

    expect(paginator.getState()).toEqual(captured.state);

    pending.resolve({ commits: [commit("c")], done: false });

    expect(await inFlight).toMatchObject({ status: "stale" });
    expect(paginator.getState()).toEqual(captured.state);
  });

  it("restores the emitted set so a trimmed rollback continues at the captured cursor", async () => {
    const order = ["c9", "c8", "c7", "c6", "c5", "c4", "c3", "c2", "c1"];
    const requests: GraphPageRequest[] = [];
    const paginator = createGraphPaginator({
      pageSize: 2,
      maxRetainedPages: 1,
      initialScope: "all",
      listScopeTips: () => ["c9"],
      loadPage: async (request) => {
        requests.push(request);

        const candidates =
          request.frontier.length === 0
            ? order
            : order.filter((oid) => reachableFrom(chain(order), request.frontier, oid));

        return {
          commits: candidates.slice(0, 2).map((oid) => commit(oid, parents(order, oid))),
          done: candidates.length <= 2,
        };
      },
    });

    await paginator.loadInitial();
    await paginator.loadOlder();
    await paginator.loadOlder();
    await paginator.loadOlder();

    const captured = paginator.capture();

    expect(captured.state.rows.map((row) => row.oid)).toEqual(["c3", "c2"]);
    expect(captured.state.frontier).toEqual(["c1"]);
    expect(captured.emitted).toEqual(["c9", "c8", "c7", "c6", "c5", "c4", "c3", "c2"]);

    paginator.reset("all");
    await paginator.loadInitial();

    expect(paginator.getState().rows.map((row) => row.oid)).toEqual(["c9", "c8"]);

    paginator.restore(captured);

    expect(paginator.capture().emitted).toEqual(captured.emitted);

    const outcome = await paginator.loadOlder();

    expect(requests.at(-1)?.frontier).toEqual(["c1"]);
    expect(outcome.status).toBe("done");
    expect(paginator.getState().rows.map((row) => row.oid)).toEqual(["c2", "c1"]);
    expect(paginator.getState().frontier).toEqual([]);
  });
});

/**
 * Builds parent lists for a linear newest-first chain.
 *
 * @param order - OIDs from newest to oldest.
 * @returns Parent OIDs per commit.
 */
function chain(order: readonly string[]): Readonly<Record<string, readonly string[]>> {
  return Object.fromEntries(order.map((oid) => [oid, parents(order, oid)]));
}

/**
 * Reads the parent of one OID in a linear newest-first chain.
 *
 * @param order - OIDs from newest to oldest.
 * @param oid - Commit OID.
 * @returns Parent list.
 */
function parents(order: readonly string[], oid: string): readonly string[] {
  const index = order.indexOf(oid);

  return index >= 0 && index + 1 < order.length ? [order[index + 1] as string] : [];
}
