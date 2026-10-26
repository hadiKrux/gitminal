import { beforeEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode, useCallback, useRef, useState } from "react";
import { createGraphPaginator } from "@/domain/graph/graph.paginate";
import type { GraphPaginator } from "@/domain/graph/graph.types";
import { useScopeTipsReload } from "@/features/graph/useScopeTipsReload";

/**
 * Builds the paginator identity the probe reloads for.
 *
 * The hook only compares this object and never issues a page itself, so the loader is unreachable.
 *
 * @returns A fresh paginator.
 */
function createProbePaginator(): GraphPaginator {
  return createGraphPaginator({
    pageSize: 10,
    initialScope: "all",
    loadPage: async () => ({ commits: [], done: false }),
  });
}

/** Paginator identity passed to the hook. */
let paginator = createProbePaginator();

/** Tip keys each reload seeded, in call order. */
let attempts: string[] = [];

/** Tip changes the fake reload publishes after it records its seeded key. */
let pendingTips: string[] = [];

/** Tip key the successful reload recorded last. */
let recordedKey = "t0";

/** Whether the fake reloader reports a joined reload. */
let coalescedNext = false;

/** Whether the next fake reload fails without a thrown message. */
let failNext = false;

/** Publishes a new tip key, standing in for a repository snapshot change. */
let setTipKey: (key: string) => void = () => {};

/** Publishes a successful reload outside the tips loop, standing in for a manual window refresh. */
let externalRefresh: () => void = () => {};

/** Renders the tips hook with a scripted reloader. */
function Probe(): ReactNode {
  const [tipKey, setKey] = useState("t0");
  const [, setRefreshTick] = useState(0);
  const recordedTipsKeyRef = useRef("t0");
  const scopeTipsKeyRef = useRef("t0");
  const reloadingTipsRef = useRef(false);
  const tipsPaginatorRef = useRef(paginator);

  setTipKey = setKey;
  scopeTipsKeyRef.current = tipKey;

  externalRefresh = () => {
    recordedTipsKeyRef.current = scopeTipsKeyRef.current;
    recordedKey = scopeTipsKeyRef.current;
    setRefreshTick((tick) => tick + 1);
  };

  const setPageError = useCallback((): void => {}, []);
  const refreshGraphWindow = useCallback(async () => {
    const seeded = scopeTipsKeyRef.current;

    attempts.push(seeded);

    if (failNext) {
      return { ok: false, coalesced: false, error: null };
    }

    recordedTipsKeyRef.current = seeded;
    recordedKey = seeded;

    const next = pendingTips.shift();

    if (next !== undefined) {
      scopeTipsKeyRef.current = next;
      setKey(next);
    }

    // Let React commit the tip change while the reload is still in flight, so its effect is skipped
    // by the in-flight guard exactly as a real snapshot update is.
    await new Promise((resolve) => setTimeout(resolve, 10));

    return { ok: true, coalesced: coalescedNext, error: null };
  }, []);

  useScopeTipsReload({
    paginator,
    pagesLoaded: 2,
    refreshGraphWindow,
    scopeTipsKey: tipKey,
    searchOpen: false,
    setPageError,
    tipsPaginatorRef,
    recordedTipsKeyRef,
    reloadingTipsRef,
    scopeTipsKeyRef,
  });

  return <text>{tipKey}</text>;
}

/**
 * Waits until a predicate is true or the deadline passes.
 *
 * @param setup - Renderer setup.
 * @param predicate - Condition to poll.
 * @param timeoutMs - Maximum wait.
 */
async function waitFor(
  setup: Awaited<ReturnType<typeof testRender>>,
  predicate: () => boolean,
  timeoutMs: number = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!predicate() && Date.now() < deadline) {
    await act(async () => {
      await setup.renderOnce();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

beforeEach(() => {
  paginator = createProbePaginator();
  attempts = [];
  pendingTips = [];
  recordedKey = "t0";
  coalescedNext = false;
  failNext = false;
  setTipKey = () => {};
  externalRefresh = () => {};
});

describe("useScopeTipsReload", () => {
  it("loads a fourth tip change by re-arming once after the attempt bound", async () => {
    const setup = await testRender(<Probe />, { width: 20, height: 3 });

    await act(async () => {
      await setup.renderOnce();
    });

    expect(attempts).toEqual([]);

    pendingTips = ["t2", "t3", "t4"];

    await act(async () => {
      setTipKey("t1");
      await setup.renderOnce();
    });
    await waitFor(setup, () => attempts.length >= 4);

    expect(attempts).toEqual(["t1", "t2", "t3", "t4"]);
    expect(recordedKey).toBe("t4");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("stops when a joined reload recorded the current key", async () => {
    const setup = await testRender(<Probe />, { width: 20, height: 3 });

    await act(async () => {
      await setup.renderOnce();
    });

    coalescedNext = true;

    await act(async () => {
      setTipKey("t1");
      await setup.renderOnce();
    });
    await waitFor(setup, () => attempts.length >= 1);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      await setup.renderOnce();
    });

    expect(attempts).toEqual(["t1"]);
    expect(recordedKey).toBe("t1");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("does not re-arm after a failed reload", async () => {
    const setup = await testRender(<Probe />, { width: 20, height: 3 });

    await act(async () => {
      await setup.renderOnce();
    });

    failNext = true;

    await act(async () => {
      setTipKey("t1");
      await setup.renderOnce();
    });
    await waitFor(setup, () => attempts.length >= 1);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      await setup.renderOnce();
    });

    expect(attempts).toEqual(["t1"]);
    expect(recordedKey).toBe("t0");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("stops after the round bound when the tip keeps changing", async () => {
    const setup = await testRender(<Probe />, { width: 20, height: 3 });

    await act(async () => {
      await setup.renderOnce();
    });

    pendingTips = ["t2", "t3", "t4", "t5", "t6", "t7", "t8"];

    await act(async () => {
      setTipKey("t1");
      await setup.renderOnce();
    });
    await waitFor(setup, () => attempts.length >= 6);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      await setup.renderOnce();
    });

    expect(attempts).toEqual(["t1", "t2", "t3", "t4", "t5", "t6"]);
    expect(recordedKey).toBe("t6");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("loads the next tip after a successful external reload resets the round bound", async () => {
    const setup = await testRender(<Probe />, { width: 20, height: 3 });

    await act(async () => {
      await setup.renderOnce();
    });

    pendingTips = ["t2", "t3", "t4", "t5", "t6", "t7", "t8"];

    await act(async () => {
      setTipKey("t1");
      await setup.renderOnce();
    });
    await waitFor(setup, () => attempts.length >= 6);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      await setup.renderOnce();
    });

    expect(attempts).toHaveLength(6);

    await act(async () => {
      externalRefresh();
      await setup.renderOnce();
    });

    await act(async () => {
      setTipKey("t9");
      await setup.renderOnce();
    });
    await waitFor(setup, () => attempts.length >= 7);

    expect(attempts.at(-1)).toBe("t9");
    expect(recordedKey).toBe("t9");

    await act(async () => {
      await setup.dispose();
    });
  });
});
