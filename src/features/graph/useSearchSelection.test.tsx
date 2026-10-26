import { beforeEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import type { EnsureLoadedResult } from "@/domain/graph/graph.types";
import type { SearchResultView } from "@/features/graph/graph.types";
import { useSearchSelection } from "@/features/graph/useSearchSelection";

/** Captured hook handle. */
let latest: ReturnType<typeof useSearchSelection> | undefined;

/** Bounded-miss writes made by the hook. */
let misses: boolean[] = [];

/** Walk-error writes made by the hook. */
let walkErrors: Array<{ readonly message: string; readonly retryable: boolean } | null> = [];

/** Close requests made by the hook. */
let closes: Array<{ readonly mode: string; readonly cursorId?: string }> = [];

/** Commit selections requested by the hook. */
let selections: string[] = [];

/** Outcome the injected selector returns. */
let outcome: EnsureLoadedResult = "cancelled";

/** The single fake search result. */
const RESULT = { id: "abc123" } as unknown as SearchResultView;

/** Renders the hook with scripted collaborators. */
function Probe(): ReactNode {
  latest = useSearchSelection({
    results: [RESULT],
    isOpen: true,
    isResultsMode: true,
    isLoading: false,
    done: true,
    closeSearch: (mode, cursorId) => {
      closes.push({ mode, cursorId });
    },
    selectCommit: async (oid) => {
      selections.push(oid);

      return outcome;
    },
    setBoundedMiss: (visible) => {
      misses.push(visible);
    },
    setWalkError: (error) => {
      walkErrors.push(error);
    },
    loadMore: async () => {},
  });

  return null;
}

beforeEach(() => {
  latest = undefined;
  misses = [];
  walkErrors = [];
  closes = [];
  selections = [];
  outcome = "cancelled";
});

describe("useSearchSelection confirm", () => {
  it("closes with success when the result loaded", async () => {
    outcome = "loaded";
    const setup = await testRender(<Probe />, { width: 40, height: 6 });

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      latest?.submit();
      await setup.renderOnce();
    });

    expect(selections).toEqual(["abc123"]);
    expect(misses).toEqual([]);
    expect(walkErrors).toEqual([]);
    expect(closes).toEqual([{ mode: "confirm-success", cursorId: "abc123" }]);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("closes neutrally when a refresh cancelled the bounded walk", async () => {
    const setup = await testRender(<Probe />, { width: 40, height: 6 });

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      latest?.submit();
      await setup.renderOnce();
    });

    expect(selections).toEqual(["abc123"]);
    expect(misses).toEqual([]);
    expect(walkErrors).toEqual([]);
    expect(closes).toEqual([{ mode: "cancel", cursorId: undefined }]);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("closes neutrally and shows the page error when the walk failed a read", async () => {
    outcome = "error";
    const setup = await testRender(<Probe />, { width: 40, height: 6 });

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      latest?.submit();
      await setup.renderOnce();
    });

    expect(selections).toEqual(["abc123"]);
    expect(misses).toEqual([]);
    expect(walkErrors).toEqual([
      { message: "Unable to load the selected commit", retryable: false },
    ]);
    expect(closes).toEqual([{ mode: "cancel", cursorId: undefined }]);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows the miss row for a genuine bounded miss", async () => {
    outcome = "notFound";
    const setup = await testRender(<Probe />, { width: 40, height: 6 });

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      latest?.submit();
      await setup.renderOnce();
    });

    expect(misses).toEqual([true]);
    expect(walkErrors).toEqual([]);
    expect(closes).toEqual([{ mode: "confirm-failure", cursorId: undefined }]);

    await act(async () => {
      await setup.dispose();
    });
  });
});
