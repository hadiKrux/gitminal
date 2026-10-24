import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { AppShellHost } from "@/app/AppShellHost";
import {
  getActionRegistryVersion,
  hasRegisteredAction,
  resetActionRegistry,
} from "@/app/hooks/useAction";
import { useFocusState } from "@/app/hooks/useFocusState";
import { useStatus } from "@/app/hooks/useStatus";
import { ConfigProvider } from "@/app/providers/ConfigProvider";
import { FocusProvider } from "@/app/providers/FocusProvider";
import { KeymapProvider } from "@/app/providers/KeymapProvider";
import { StatusProvider } from "@/app/providers/StatusProvider";
import type { StatusContextValue } from "@/app/providers/StatusProvider.types";
import { ThemeProvider } from "@/app/providers/ThemeProvider";
import type { FocusContextValue } from "@/features/shell/focus.types";
import { FOCUS_ACTION_BY_REGION } from "@/features/shell/regions";

/** Latest focus context captured by the probe. */
let latestFocus: FocusContextValue | undefined;

/** Latest status context captured by the probe. */
let latestStatus: StatusContextValue | undefined;

/**
 * Captures the active region below the shell.
 *
 * @returns A status line.
 */
function FocusProbe(): ReactNode {
  latestFocus = useFocusState();

  return <text id="active-region">{latestFocus.state.activeRegion ?? "none"}</text>;
}

/**
 * Captures the status context below the shell.
 *
 * @returns A status line.
 */
function StatusProbe(): ReactNode {
  latestStatus = useStatus();

  return <text id="status-message">{latestStatus.status?.message ?? "none"}</text>;
}

/**
 * Renders the composition root with the required providers.
 *
 * @returns The renderer setup.
 */
async function renderHost(): Promise<Awaited<ReturnType<typeof testRender>>> {
  latestFocus = undefined;
  latestStatus = undefined;

  return testRender(
    <ConfigProvider>
      <ThemeProvider>
        <KeymapProvider platform="linux">
          <FocusProvider>
            <StatusProvider>
              <box flexDirection="column" flexGrow={1} width={120} height={40}>
                <AppShellHost />
                <FocusProbe />
                <StatusProbe />
              </box>
            </StatusProvider>
          </FocusProvider>
        </KeymapProvider>
      </ThemeProvider>
    </ConfigProvider>,
    { width: 120, height: 40, exitOnCtrlC: false, kittyKeyboard: true },
  );
}

beforeEach(() => {
  resetActionRegistry();
});

describe("AppShellHost", () => {
  it("composes every placeholder surface inside the shell", async () => {
    const setup = await renderHost();

    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();

    expect(frame).toContain("Gitminal");
    expect(frame).toContain("Branches");
    expect(frame).toContain("Commit graph");
    expect(frame).toContain("Commit composer");
    expect(frame).toContain("Diffs");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("registers every global action exactly once", async () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    const versionBefore = getActionRegistryVersion();
    const expected = [
      ...Object.values(FOCUS_ACTION_BY_REGION),
      "focus.next",
      "focus.previous",
      "app.quit",
      "overlay.close",
      "app.console",
    ];
    const setup = await renderHost();

    await act(async () => {
      await setup.renderOnce();
    });

    for (const actionId of expected) {
      expect(hasRegisteredAction(actionId, "global")).toBe(true);
    }

    expect(getActionRegistryVersion() - versionBefore).toBe(expected.length);
    expect(consoleError).not.toHaveBeenCalled();

    consoleError.mockRestore();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("quits on q through the app.quit handler", async () => {
    const setup = await renderHost();
    const destroy = spyOn(setup.renderer, "destroy").mockImplementation(() => {});

    await act(async () => {
      await setup.renderOnce();
    });
    await act(async () => {
      setup.mockInput.pressKey("q");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(destroy).toHaveBeenCalledTimes(1);

    destroy.mockRestore();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("clears a transient status and restores the previous region in one Esc press", async () => {
    const setup = await renderHost();

    await act(async () => {
      await setup.renderOnce();
    });
    await act(async () => {
      latestStatus?.setStatus({ kind: "info", message: "saved" }, 60_000);
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestStatus?.status?.message).toBe("saved");

    await act(async () => {
      setup.mockInput.pressKey("6");
    });
    await act(async () => {
      await setup.renderOnce();
    });
    await act(async () => {
      setup.mockInput.pressKey("7");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestFocus?.state.activeRegion).toBe("right-pane");
    expect(latestFocus?.state.previousRegion).toBe("graph");

    await act(async () => {
      setup.mockInput.pressEscape();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestStatus?.status).toBeNull();
    expect(latestFocus?.state.activeRegion).toBe("graph");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region-graph");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("toggles the console drawer with the console action", async () => {
    const setup = await renderHost();

    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).not.toContain("Command console");

    await act(async () => {
      setup.mockInput.pressKey("`", { ctrl: true });
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).toContain("Command console");

    await act(async () => {
      setup.mockInput.pressKey("`", { ctrl: true });
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).not.toContain("Command console");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("opens and focuses the console from digit 9", async () => {
    const setup = await renderHost();

    await act(async () => {
      await setup.renderOnce();
    });
    await act(async () => {
      setup.mockInput.pressKey("9");
    });
    await act(async () => {
      await setup.renderOnce();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).toContain("Command console");
    expect(latestFocus?.state.activeRegion).toBe("console");

    await act(async () => {
      await setup.dispose();
    });
  });
});
