import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode, useEffect } from "react";
import {
  hasRegisteredAction,
  resetActionRegistry,
  resolveActionHandler,
} from "@/app/hooks/useAction";
import { useConsoleLog } from "@/app/hooks/useConsoleLog";
import { useFocusRegion } from "@/app/hooks/useFocusRegion";
import { useHotkeys } from "@/app/hooks/useHotkeys";
import { useOverlay } from "@/app/hooks/useOverlay";
import { useStatus } from "@/app/hooks/useStatus";
import { readConsoleEntryRows } from "@/domain/console/console.rows";
import type { ConsoleEntry } from "@/domain/console/console.types";
import type { GitClient, GitInvocationResult } from "@/domain/git/git.types";
import { ConsoleDrawer } from "@/features/console/ConsoleDrawer";
import { AppTestProviders } from "@/test/app.harness";

/** Console context value read from the hook, without importing an app provider type. */
type ConsoleLogValue = ReturnType<typeof useConsoleLog>;

/** Overlay context value read from the hook, without importing an app provider type. */
type OverlayValue = ReturnType<typeof useOverlay>;

/** Status context value read from the hook, without importing an app provider type. */
type StatusValue = ReturnType<typeof useStatus>;

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

/** Latest console context captured by the probe. */
let latestLog: ConsoleLogValue | undefined;

/** Latest overlay context captured by the probe. */
let latestOverlay: OverlayValue | undefined;

/** Latest status context captured by the probe. */
let latestStatus: StatusValue | undefined;

/**
 * Captures the console and overlay contexts.
 *
 * @returns A non-focusable marker.
 */
function DrawerProbe(): ReactNode {
  latestLog = useConsoleLog();
  latestOverlay = useOverlay();
  latestStatus = useStatus();

  return <text id="drawer-probe">probe</text>;
}

/**
 * Renders the drawer inside a focusable console region and focuses it on mount.
 *
 * @returns The harness layout.
 */
function DrawerHarness(): ReactNode {
  const region = useFocusRegion("console");
  const { focus } = region;

  useHotkeys();

  useEffect(() => {
    focus();
  }, [focus]);

  return (
    <box {...region.regionProps} flexDirection="column" width={100} height={12}>
      <ConsoleDrawer />
    </box>
  );
}

/**
 * Renders the drawer and its providers.
 *
 * @returns The renderer setup.
 */
async function renderDrawer(): Promise<Awaited<ReturnType<typeof testRender>>> {
  latestLog = undefined;
  latestOverlay = undefined;
  latestStatus = undefined;

  return testRender(
    <AppTestProviders gitClient={INERT_CLIENT}>
      <box flexDirection="column" width={100} height={14}>
        <DrawerProbe />
        <DrawerHarness />
      </box>
    </AppTestProviders>,
    { width: 100, height: 14, kittyKeyboard: true },
  );
}

/**
 * Builds one console entry.
 *
 * @param overrides - Entry fields to override.
 * @returns The console entry.
 */
function entry(overrides: Partial<ConsoleEntry> = {}): ConsoleEntry {
  return {
    id: "entry-1",
    at: 0,
    commandId: "remote.fetch",
    operationLabel: "Fetch",
    steps: [
      {
        argv: ["git", "fetch", "--progress", "origin"],
        exitCode: 0,
        durationMs: 1200,
        stdout: { text: "", omittedLines: 0, totalLines: 0 },
        stderr: { text: "", omittedLines: 0, totalLines: 0 },
      },
    ],
    cwd: null,
    status: "success",
    exitCode: 0,
    durationMs: 1200,
    phase: "Receiving objects",
    cancelled: false,
    timedOut: false,
    summary: "1 step completed",
    decisiveError: null,
    ...overrides,
  };
}

/**
 * Presses one key and renders once.
 *
 * @param setup - Renderer setup.
 * @param key - Key to press.
 */
async function pressKey(setup: Awaited<ReturnType<typeof testRender>>, key: string): Promise<void> {
  await act(async () => {
    setup.mockInput.pressKey(key);
  });
  await act(async () => {
    await setup.renderOnce();
  });
}

/**
 * Presses Enter and renders once.
 *
 * @param setup - Renderer setup.
 */
async function pressEnter(setup: Awaited<ReturnType<typeof testRender>>): Promise<void> {
  await act(async () => {
    setup.mockInput.pressEnter();
  });
  await act(async () => {
    await setup.renderOnce();
  });
}

beforeEach(() => {
  resetActionRegistry();
  latestLog = undefined;
  latestOverlay = undefined;
  latestStatus = undefined;
});

describe("ConsoleDrawer", () => {
  it("renders the empty state with a singular count and no clear hint", async () => {
    const setup = await renderDrawer();

    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();

    expect(frame).toContain("No commands yet.");
    expect(frame).toContain("0 entries");
    expect(frame).not.toContain("Clear console");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("renders every documented entry field", async () => {
    const setup = await renderDrawer();

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      latestLog?.append(entry({ cwd: "/repo/sub" }));
    });
    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();

    expect(frame).toContain("1 entry");
    expect(frame).toContain("following");
    expect(frame).toContain("Fetch");
    expect(frame).toContain("git fetch --progress origin");
    expect(frame).toContain("cwd /repo/sub");
    expect(frame).toContain("exit 0");
    expect(frame).toContain("1.2s");
    expect(frame).toContain("phase Receiving objects");
    expect(frame).toContain("1 step completed");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("renders each entry at the height the row measurement reports", async () => {
    const setup = await renderDrawer();

    await act(async () => {
      await setup.renderOnce();
    });

    const consoleEntry = entry({ cwd: "/repo/sub" });

    await act(async () => {
      latestLog?.append(consoleEntry);
    });
    await act(async () => {
      await setup.renderOnce();
    });

    const row = setup.renderer.root.findDescendantById(consoleEntry.id);

    expect(row?.height).toBe(readConsoleEntryRows(consoleEntry, false));

    await act(async () => {
      await setup.dispose();
    });
  });

  it("pluralizes the entry count", async () => {
    const setup = await renderDrawer();

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      latestLog?.append(entry({ id: "entry-1" }));
      latestLog?.append(entry({ id: "entry-2" }));
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).toContain("2 entries");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("expands a failure entry by default and shows its stderr", async () => {
    const setup = await renderDrawer();

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      latestLog?.append(
        entry({
          id: "failure",
          status: "failure",
          exitCode: 128,
          summary: "fatal: Authentication failed",
          decisiveError: "fatal: Authentication failed",
          steps: [
            {
              argv: ["git", "fetch", "--progress", "origin"],
              exitCode: 128,
              durationMs: 20,
              stdout: { text: "", omittedLines: 0, totalLines: 0 },
              stderr: {
                text: "fatal: Authentication failed",
                omittedLines: 0,
                totalLines: 1,
              },
            },
          ],
        }),
      );
    });
    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();

    expect(frame).toContain("exit 128");
    expect(frame).toContain("stderr");
    expect(frame).toContain("fatal: Authentication failed");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows the running operation as a spinner row while a command is active", async () => {
    const setup = await renderDrawer();

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      latestStatus?.beginOperation("Fetch");
      latestStatus?.updateOperation({ phase: "Receiving objects", percent: 42 });
    });
    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();

    expect(frame).toContain("Fetch Receiving objects 42%");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows a cancelled entry as cancelled, never as success", async () => {
    const setup = await renderDrawer();

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      latestLog?.append(
        entry({
          id: "cancelled",
          status: "cancelled",
          exitCode: null,
          summary: "cancelled",
          decisiveError: null,
        }),
      );
    });
    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();

    expect(frame).toContain("cancelled");
    expect(frame.match(/cancelled/g)).toHaveLength(1);
    expect(frame).not.toContain("exit 0");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows a timed-out entry with its reported duration, never as success", async () => {
    const setup = await renderDrawer();

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      latestLog?.append(
        entry({
          id: "timed-out",
          status: "timed-out",
          exitCode: null,
          summary: "timed out after 120 seconds",
          decisiveError: null,
        }),
      );
    });
    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();

    expect(frame).toContain("timed out after 120 seconds");
    expect(frame).not.toContain("exit 0");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("clears the history only after the overlay confirmation", async () => {
    const setup = await renderDrawer();

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      latestLog?.append(entry());
    });
    await act(async () => {
      await setup.renderOnce();
    });

    await pressKey(setup, "c");

    expect(latestOverlay?.entry?.kind).toBe("confirm");
    expect(latestLog?.entries).toHaveLength(1);

    await act(async () => {
      if (latestOverlay?.entry?.kind === "confirm") {
        latestOverlay.entry.onConfirm();
      }
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestLog?.entries).toHaveLength(0);
    expect(setup.captureCharFrame()).toContain("No commands yet.");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("expands and collapses the selected entry from the keyboard", async () => {
    const setup = await renderDrawer();

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      latestLog?.append(
        entry({
          steps: [
            {
              argv: ["git", "fetch", "--progress", "origin"],
              exitCode: 0,
              durationMs: 1200,
              stdout: { text: "receiving objects", omittedLines: 0, totalLines: 1 },
              stderr: { text: "", omittedLines: 0, totalLines: 0 },
            },
          ],
        }),
      );
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).not.toContain("stdout");

    await pressEnter(setup);

    expect(setup.captureCharFrame()).toContain("stdout");
    expect(setup.captureCharFrame()).toContain("receiving objects");

    await pressEnter(setup);

    expect(setup.captureCharFrame()).not.toContain("stdout");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("copies selected log text through the renderer clipboard", async () => {
    const setup = await renderDrawer();

    await act(async () => {
      await setup.renderOnce();
    });

    const copy = spyOn(setup.renderer, "copyToClipboardOSC52").mockReturnValue(true);

    await act(async () => {
      setup.renderer.emit("selection", {
        isDragging: false,
        getSelectedText: () => "console output",
      } as never);
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(copy).toHaveBeenCalledWith("console output");
    expect(latestStatus?.status).toEqual({ kind: "info", message: "Selection copied" });

    copy.mockRestore();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("pauses follow mode when the log is scrolled up", async () => {
    const setup = await renderDrawer();

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      for (let index = 0; index < 12; index += 1) {
        latestLog?.append(entry({ id: `entry-${index}` }));
      }
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestLog?.followMode).toBe(true);

    await act(async () => {
      await setup.mockMouse.scroll(20, 8, "up");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestLog?.followMode).toBe(false);
    expect(setup.captureCharFrame()).toContain("paused");

    await act(async () => {
      latestLog?.append(entry({ id: "entry-new" }));
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).toContain("1 new entry");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("resumes follow mode when the log is scrolled back to the bottom", async () => {
    const setup = await renderDrawer();

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      for (let index = 0; index < 12; index += 1) {
        latestLog?.append(entry({ id: `entry-${index}` }));
      }
    });
    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      await setup.mockMouse.scroll(20, 8, "up");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestLog?.followMode).toBe(false);

    for (let index = 0; index < 20; index += 1) {
      await act(async () => {
        await setup.mockMouse.scroll(20, 8, "down");
      });
      await act(async () => {
        await setup.renderOnce();
      });
    }

    expect(latestLog?.followMode).toBe(true);
    expect(latestLog?.newEntryCount).toBe(0);
    expect(setup.captureCharFrame()).toContain("following");
    expect(setup.captureCharFrame()).not.toContain("paused");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("registers only console.clear and nav.* in the console scope", async () => {
    const setup = await renderDrawer();

    await act(async () => {
      await setup.renderOnce();
    });

    expect(hasRegisteredAction("console.clear", "console")).toBe(true);

    for (const actionId of [
      "nav.up",
      "nav.down",
      "nav.pageUp",
      "nav.pageDown",
      "nav.first",
      "nav.last",
      "nav.activate",
    ]) {
      expect(hasRegisteredAction(actionId, "console"), actionId).toBe(true);
    }

    expect(resolveActionHandler("app.console", "console")).toBeUndefined();
    expect(resolveActionHandler("focus.next", "console")).toBeUndefined();
    expect(hasRegisteredAction("app.console", "global")).toBe(false);
    expect(hasRegisteredAction("focus.region.console", "global")).toBe(false);

    await act(async () => {
      await setup.dispose();
    });
  });
});
