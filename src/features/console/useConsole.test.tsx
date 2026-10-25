import { beforeEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { resetActionRegistry, resolveActionHandler } from "@/app/hooks/useAction";
import { useConsoleLog } from "@/app/hooks/useConsoleLog";
import { useOverlay } from "@/app/hooks/useOverlay";
import { useStatus } from "@/app/hooks/useStatus";
import { readConsoleEntryRows } from "@/domain/console/console.rows";
import type { ConsoleEntry } from "@/domain/console/console.types";
import type { GitClient, GitInvocationResult } from "@/domain/git/git.types";
import { useConsole } from "@/features/console/useConsole";
import type { ConsoleHandle } from "@/features/console/useConsole.types";
import { AppTestProviders } from "@/test/app.harness";

/** Console context value read from the hook, without importing an app provider type. */
type ConsoleLogValue = ReturnType<typeof useConsoleLog>;

/** Overlay context value read from the hook, without importing an app provider type. */
type OverlayValue = ReturnType<typeof useOverlay>;

/** Inert git client so provider reads never spawn a process. */
const INERT_CLIENT: GitClient = {
  gitPath: "git",
  invoke: async (): Promise<GitInvocationResult> => ({
    argv: ["git"],
    cwd: "/repo",
    exitCode: 128,
    terminationSignal: null,
    stdout: "",
    stderr: "fatal: not a git repository",
    durationMs: 0,
    cancelled: false,
    timedOut: false,
    timedOutAfterMs: null,
    spawnError: null,
    ok: false,
  }),
};

/** Latest console hook value captured by the probe. */
let latestView: ConsoleHandle | undefined;

/** Latest console context captured by the probe. */
let latestLog: ConsoleLogValue | undefined;

/** Latest overlay context captured by the probe. */
let latestOverlay: OverlayValue | undefined;

/** Latest status context captured by the probe. */
let latestStatus: ReturnType<typeof useStatus> | undefined;

/**
 * Captures the console hook and renders a viewport so page navigation has a real height.
 *
 * Each probe row uses the production entry-height rule, so page navigation is tested against the
 * multi-row entries the drawer actually renders rather than one-row placeholders.
 *
 * @param props - Visible viewport height in rows.
 * @returns The console viewport.
 */
function ConsoleProbe(props: { readonly viewportHeight: number }): ReactNode {
  const view = useConsole();
  const log = useConsoleLog();

  latestView = view;
  latestLog = log;
  latestOverlay = useOverlay();
  latestStatus = useStatus();

  return (
    <scrollbox ref={view.scrollRef} height={props.viewportHeight} focusable={false}>
      {log.entries.map((consoleEntry) => (
        <box
          key={consoleEntry.id}
          id={consoleEntry.id}
          height={readConsoleEntryRows(consoleEntry, log.expandedEntryIds.has(consoleEntry.id))}
        >
          <text>{consoleEntry.id}</text>
        </box>
      ))}
    </scrollbox>
  );
}

/**
 * Renders the console hook inside the full provider stack.
 *
 * @param options - Initial follow mode and viewport height.
 * @returns The renderer setup.
 */
async function renderConsoleHook(
  options: { readonly initialFollowMode?: boolean; readonly viewportHeight?: number } = {},
): Promise<Awaited<ReturnType<typeof testRender>>> {
  latestView = undefined;
  latestLog = undefined;
  latestOverlay = undefined;
  latestStatus = undefined;

  return testRender(
    <AppTestProviders gitClient={INERT_CLIENT} initialFollowMode={options.initialFollowMode}>
      <ConsoleProbe viewportHeight={options.viewportHeight ?? 5} />
    </AppTestProviders>,
    { width: 80, height: 20 },
  );
}

/**
 * Builds one console entry.
 *
 * @param id - Entry id.
 * @param status - Entry outcome.
 * @param overrides - Entry fields to override.
 * @returns The entry.
 */
function entry(
  id: string,
  status: ConsoleEntry["status"] = "success",
  overrides: Partial<ConsoleEntry> = {},
): ConsoleEntry {
  return {
    id,
    at: 0,
    commandId: "remote.fetch",
    operationLabel: "Fetch",
    steps: [],
    cwd: null,
    status,
    exitCode: status === "failure" ? 1 : 0,
    durationMs: 1,
    phase: null,
    cancelled: status === "cancelled",
    timedOut: status === "timed-out",
    summary: status === "failure" ? "fatal: nope" : "completed",
    decisiveError: status === "failure" ? "fatal: nope" : null,
    ...overrides,
  };
}

/**
 * Runs one console-scoped action by id.
 *
 * @param actionId - Console action id.
 */
function runConsoleAction(actionId: string): void {
  resolveActionHandler(actionId, "console")?.();
}

beforeEach(() => {
  resetActionRegistry();
  latestView = undefined;
  latestLog = undefined;
  latestOverlay = undefined;
  latestStatus = undefined;
});

describe("useConsole", () => {
  it("follows the newest entry while follow mode is active", async () => {
    const setup = await renderConsoleHook();

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      latestLog?.append(entry("a"));
      latestLog?.append(entry("b"));
    });

    expect(latestView?.selectedEntryId).toBe("b");
    expect(latestLog?.followMode).toBe(true);
    expect(latestLog?.newEntryCount).toBe(0);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("pauses follow when the cursor moves up and counts entries appended behind it", async () => {
    const setup = await renderConsoleHook();

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      latestLog?.append(entry("a"));
      latestLog?.append(entry("b"));
    });
    await act(async () => {
      runConsoleAction("nav.up");
    });

    expect(latestView?.selectedEntryId).toBe("a");
    expect(latestLog?.followMode).toBe(false);

    await act(async () => {
      latestLog?.append(entry("c"));
    });

    expect(latestView?.selectedEntryId).toBe("a");
    expect(latestLog?.newEntryCount).toBe(1);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("resumes follow and clears the new-entry count at the newest entry", async () => {
    const setup = await renderConsoleHook();

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      latestLog?.append(entry("a"));
      latestLog?.append(entry("b"));
    });
    await act(async () => {
      runConsoleAction("nav.up");
    });
    await act(async () => {
      latestLog?.append(entry("c"));
    });
    await act(async () => {
      runConsoleAction("nav.last");
    });

    expect(latestView?.selectedEntryId).toBe("c");
    expect(latestLog?.followMode).toBe(true);
    expect(latestLog?.newEntryCount).toBe(0);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("moves by the entries that fill one viewport, not by raw rows", async () => {
    const setup = await renderConsoleHook({ viewportHeight: 5 });

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      for (let index = 0; index < 10; index += 1) {
        latestLog?.append(
          entry(`entry-${index}`, "success", {
            cwd: "/repo/sub",
            steps: [
              {
                argv: ["git", "fetch", "origin"],
                exitCode: 0,
                durationMs: 1,
                stdout: { text: "", omittedLines: 0, totalLines: 0 },
                stderr: { text: "", omittedLines: 0, totalLines: 0 },
              },
            ],
          }),
        );
      }
    });

    await act(async () => {
      runConsoleAction("nav.pageUp");
    });

    expect(latestView?.selectedEntryId).toBe("entry-8");

    await act(async () => {
      runConsoleAction("nav.pageDown");
    });

    expect(latestView?.selectedEntryId).toBe("entry-9");

    await act(async () => {
      runConsoleAction("nav.first");
    });

    expect(latestView?.selectedEntryId).toBe("entry-0");
    expect(latestLog?.followMode).toBe(false);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("reserves the running spinner row when computing the page step", async () => {
    const setup = await renderConsoleHook({ viewportHeight: 9 });

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      for (let index = 0; index < 10; index += 1) {
        latestLog?.append(
          entry(`entry-${index}`, "success", {
            cwd: "/repo/sub",
            steps: [
              {
                argv: ["git", "fetch", "origin"],
                exitCode: 0,
                durationMs: 1,
                stdout: { text: "", omittedLines: 0, totalLines: 0 },
                stderr: { text: "", omittedLines: 0, totalLines: 0 },
              },
            ],
          }),
        );
      }
    });

    await act(async () => {
      latestStatus?.beginOperation("Fetch");
    });
    await act(async () => {
      runConsoleAction("nav.pageUp");
    });

    expect(latestView?.selectedEntryId).toBe("entry-8");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("toggles the selected entry with nav.activate", async () => {
    const setup = await renderConsoleHook();

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      latestLog?.append(
        entry("a", "success", {
          steps: [
            {
              argv: ["git", "fetch", "origin"],
              exitCode: 0,
              durationMs: 1,
              stdout: { text: "receiving", omittedLines: 0, totalLines: 1 },
              stderr: { text: "", omittedLines: 0, totalLines: 0 },
            },
          ],
        }),
      );
    });

    await act(async () => {
      runConsoleAction("nav.activate");
    });

    expect(latestLog?.expandedEntryIds.has("a")).toBe(true);

    await act(async () => {
      runConsoleAction("nav.activate");
    });

    expect(latestLog?.expandedEntryIds.has("a")).toBe(false);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("resumes follow when a fresh paused drawer lands on the newest entry", async () => {
    const setup = await renderConsoleHook({ initialFollowMode: false });

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      latestLog?.append(entry("a"));
      latestLog?.append(entry("b"));
    });

    expect(latestView?.selectedEntryId).toBe("b");
    expect(latestLog?.followMode).toBe(true);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("consumes a cross-surface selection request and pauses follow", async () => {
    const setup = await renderConsoleHook();

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      latestLog?.append(entry("a"));
      latestLog?.append(entry("b"));
      latestLog?.requestEntrySelection("a");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestView?.selectedEntryId).toBe("a");
    expect(latestLog?.followMode).toBe(false);
    expect(latestLog?.pendingSelectionEntryId).toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("clears a selection request for an entry that was trimmed", async () => {
    const setup = await renderConsoleHook();

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      latestLog?.append(entry("a"));
      latestLog?.requestEntrySelection("missing");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestLog?.pendingSelectionEntryId).toBeNull();
    expect(latestView?.selectedEntryId).toBe("a");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("does nothing when clear is requested with no history", async () => {
    const setup = await renderConsoleHook();

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      runConsoleAction("console.clear");
    });

    expect(latestOverlay?.entry).toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("requests a clear confirmation and clears only after confirmation", async () => {
    const setup = await renderConsoleHook();

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      latestLog?.append(entry("a"));
    });

    await act(async () => {
      runConsoleAction("console.clear");
    });

    expect(latestOverlay?.entry?.kind).toBe("confirm");

    if (latestOverlay?.entry?.kind === "confirm") {
      expect(latestOverlay.entry.title).toBe("Clear console");
      expect(latestOverlay.entry.confirmLabel).toBe("Clear console");
      expect(latestOverlay.entry.labelWarning).toBeUndefined();
    }

    expect(latestLog?.entries).toHaveLength(1);

    await act(async () => {
      if (latestOverlay?.entry?.kind === "confirm") {
        latestOverlay.entry.onConfirm();
      }
    });

    expect(latestLog?.entries).toHaveLength(0);
    expect(latestOverlay?.entry).toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("does not keep its own follow or expansion copy", async () => {
    const setup = await renderConsoleHook();

    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestView).not.toBeNull();
    expect(Object.hasOwn(latestView ?? {}, "followMode")).toBe(false);
    expect(Object.hasOwn(latestView ?? {}, "expandedEntryIds")).toBe(false);

    await act(async () => {
      await setup.dispose();
    });
  });
});
