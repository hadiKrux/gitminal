import { beforeEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { useConsoleLog } from "@/app/hooks/useConsoleLog";
import { ConsoleProvider } from "@/app/providers/ConsoleProvider";
import type { ConsoleContextValue } from "@/app/providers/ConsoleProvider.types";
import type { ConsoleEntry } from "@/domain/console/console.types";

/** Latest console context captured by the probe. */
let latest: ConsoleContextValue | undefined;

/**
 * Builds a minimal console entry.
 *
 * @param id - Entry id.
 * @returns The entry.
 */
function entry(id: string): ConsoleEntry {
  return {
    id,
    at: 0,
    commandId: "remote.fetch",
    operationLabel: "Fetch",
    steps: [],
    cwd: null,
    status: "success",
    exitCode: 0,
    durationMs: 1,
    phase: null,
    cancelled: false,
    timedOut: false,
    summary: "completed",
    decisiveError: null,
  };
}

/** Captures the console context. */
function ConsoleProbe(): ReactNode {
  latest = useConsoleLog();

  return <text id="console-probe">{`${latest.entries.length}:${latest.newEntryCount}`}</text>;
}

/**
 * Renders the console provider with the probe.
 *
 * @param limit - Entry bound.
 * @param initialFollowMode - Initial follow mode.
 * @returns The renderer setup.
 */
async function renderConsole(
  limit: number = 200,
  initialFollowMode: boolean = true,
): Promise<Awaited<ReturnType<typeof testRender>>> {
  latest = undefined;

  let setup: Awaited<ReturnType<typeof testRender>> | undefined;

  await act(async () => {
    setup = await testRender(
      <ConsoleProvider limit={limit} initialFollowMode={initialFollowMode}>
        <ConsoleProbe />
      </ConsoleProvider>,
      { width: 40, height: 10 },
    );
  });

  if (setup === undefined) {
    throw new Error("renderer setup missing");
  }

  return setup;
}

beforeEach(() => {
  latest = undefined;
});

describe("ConsoleProvider", () => {
  it("appends entries without incrementing the count while following", async () => {
    const setup = await renderConsole();

    await act(async () => {
      latest?.append(entry("a"));
      latest?.append(entry("b"));
    });

    expect(latest?.entries.map((candidate) => candidate.id)).toEqual(["a", "b"]);
    expect(latest?.newEntryCount).toBe(0);
    expect(latest?.followMode).toBe(true);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("counts new entries while follow mode is off and resets when following resumes", async () => {
    const setup = await renderConsole(200, false);

    await act(async () => {
      latest?.append(entry("a"));
      latest?.append(entry("b"));
    });

    expect(latest?.newEntryCount).toBe(2);

    await act(async () => {
      latest?.setFollowing(true);
    });

    expect(latest?.followMode).toBe(true);
    expect(latest?.newEntryCount).toBe(0);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("trims the history and drops expansion ids of trimmed entries", async () => {
    const setup = await renderConsole(2);

    await act(async () => {
      latest?.append(entry("a"));
      latest?.append(entry("b"));
      latest?.toggleExpanded("a");
    });

    expect([...(latest?.expandedEntryIds ?? [])]).toEqual(["a"]);

    await act(async () => {
      latest?.append(entry("c"));
    });

    expect(latest?.entries.map((candidate) => candidate.id)).toEqual(["b", "c"]);
    expect(latest?.expandedEntryIds.has("a")).toBe(false);

    await act(async () => {
      latest?.toggleExpanded("b");
    });

    expect(latest?.expandedEntryIds.has("b")).toBe(true);

    await act(async () => {
      latest?.toggleExpanded("b");
    });

    expect(latest?.expandedEntryIds.has("b")).toBe(false);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("ignores expansion of an entry that is not in the history", async () => {
    const setup = await renderConsole();

    await act(async () => {
      latest?.toggleExpanded("missing");
    });

    expect(latest?.expandedEntryIds.size).toBe(0);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("clears the history and expansion state", async () => {
    const setup = await renderConsole();

    await act(async () => {
      latest?.append(entry("a"));
      latest?.toggleExpanded("a");
      latest?.clear();
    });

    expect(latest?.entries).toEqual([]);
    expect(latest?.expandedEntryIds.size).toBe(0);
    expect(latest?.newEntryCount).toBe(0);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("expands a failure entry on append and leaves a success entry collapsed", async () => {
    const setup = await renderConsole();

    await act(async () => {
      latest?.append(entry("success"));
      latest?.append({ ...entry("failure"), status: "failure", exitCode: 1 });
    });

    expect(latest?.expandedEntryIds.has("failure")).toBe(true);
    expect(latest?.expandedEntryIds.has("success")).toBe(false);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("replaces an existing entry in place and expands it when it becomes a failure", async () => {
    const setup = await renderConsole();

    await act(async () => {
      latest?.append(entry("a"));
      latest?.append(entry("b"));
      latest?.replaceEntry({
        ...entry("b"),
        status: "failure",
        exitCode: null,
        summary: "refresh exploded",
        decisiveError: "refresh exploded",
      });
    });

    expect(latest?.entries.map((candidate) => candidate.id)).toEqual(["a", "b"]);
    expect(latest?.entries[1]?.status).toBe("failure");
    expect(latest?.entries[1]?.summary).toBe("refresh exploded");
    expect(latest?.expandedEntryIds.has("b")).toBe(true);

    await act(async () => {
      latest?.replaceEntry(entry("missing"));
    });

    expect(latest?.entries).toHaveLength(2);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("opens the drawer and carries a pending selection request", async () => {
    const setup = await renderConsole();

    await act(async () => {
      latest?.append(entry("a"));
      latest?.requestEntrySelection("a");
    });

    expect(latest?.isOpen).toBe(true);
    expect(latest?.pendingSelectionEntryId).toBe("a");

    await act(async () => {
      latest?.consumePendingSelection("a");
    });

    expect(latest?.pendingSelectionEntryId).toBeNull();

    await act(async () => {
      latest?.requestEntrySelection("a");
      latest?.clear();
    });

    expect(latest?.pendingSelectionEntryId).toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("owns drawer visibility", async () => {
    const setup = await renderConsole();

    expect(latest?.isOpen).toBe(false);

    await act(async () => {
      latest?.open();
    });

    expect(latest?.isOpen).toBe(true);

    await act(async () => {
      latest?.toggle();
    });

    expect(latest?.isOpen).toBe(false);

    await act(async () => {
      latest?.open();
      latest?.close();
    });

    expect(latest?.isOpen).toBe(false);

    await act(async () => {
      await setup.dispose();
    });
  });
});
