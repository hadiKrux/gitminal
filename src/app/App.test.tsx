import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { App } from "@/app/App";
import { APP_VERSION } from "@/app/app.constants";
import { resetActionRegistry } from "@/app/hooks/useAction";
import type { UpdateCheckResult } from "@/domain/update/update.types";

/** A check that never settles, proving the splash does not wait for the network. */
const pendingCheck = new Promise<UpdateCheckResult>(() => {});

/** Injected update check used instead of the real registry request. */
const checkForUpdateMock = mock((): Promise<UpdateCheckResult> => pendingCheck);

/** Keypress listeners the renderer registers itself, independent of mounted React subscribers. */
const RENDERER_BUILT_IN_KEYPRESS_LISTENERS = 1;

/**
 * Counts the keyboard subscriptions owned by the mounted app.
 *
 * The renderer always keeps one built-in `keypress` listener for its `exitOnCtrlC` handling, so the
 * app-owned subscriber count is the raw listener count minus that baseline.
 *
 * @param setup - The renderer setup returned by `testRender`.
 * @returns The number of app-owned `keypress` subscribers.
 */
function countKeyboardSubscribers(setup: Awaited<ReturnType<typeof testRender>>): number {
  return setup.renderer.keyInput.listenerCount("keypress") - RENDERER_BUILT_IN_KEYPRESS_LISTENERS;
}

beforeEach(() => {
  checkForUpdateMock.mockClear();
  resetActionRegistry();
});

describe("App splash gate", () => {
  it("dismisses on any key, mounts the workspace, and keeps exactly one keyboard subscriber", async () => {
    const setup = await testRender(<App checkForUpdate={checkForUpdateMock} />, {
      width: 80,
      height: 24,
      exitOnCtrlC: false,
    });

    await act(async () => {
      await setup.renderOnce();
    });

    const initialFrame = setup.captureCharFrame();

    expect(initialFrame).toContain("Press any key to continue");
    expect(initialFrame).toContain(`version ${APP_VERSION}`);
    expect(setup.renderer.root.findDescendantById("splash-wordmark")).toBeDefined();
    expect(checkForUpdateMock).toHaveBeenCalledTimes(1);
    expect(countKeyboardSubscribers(setup)).toBe(1);

    await act(async () => {
      setup.mockInput.pressKey("x");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    const dismissedFrame = setup.captureCharFrame();

    expect(dismissedFrame).toContain("Gitminal");
    expect(dismissedFrame).toContain("Branches");
    expect(dismissedFrame).toContain("Commits");
    expect(dismissedFrame).toContain("Diffs");
    expect(dismissedFrame).not.toContain("Press any key to continue");
    expect(countKeyboardSubscribers(setup)).toBe(1);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("quits through renderer.destroy on Ctrl+C instead of dismissing", async () => {
    const setup = await testRender(<App checkForUpdate={checkForUpdateMock} />, {
      width: 80,
      height: 24,
      exitOnCtrlC: false,
    });
    const destroySpy = spyOn(setup.renderer, "destroy").mockImplementation(() => {});

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      setup.mockInput.pressCtrlC();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(destroySpy).toHaveBeenCalledTimes(1);
    expect(setup.captureCharFrame()).toContain("Press any key to continue");
    expect(setup.captureCharFrame()).not.toContain("Gitminal");

    destroySpy.mockRestore();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("quits on Ctrl+C after the splash is dismissed", async () => {
    const setup = await testRender(<App checkForUpdate={checkForUpdateMock} />, {
      width: 80,
      height: 24,
      exitOnCtrlC: false,
    });
    const destroySpy = spyOn(setup.renderer, "destroy").mockImplementation(() => {});

    await act(async () => {
      await setup.renderOnce();
    });
    await act(async () => {
      setup.mockInput.pressKey("x");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).toContain("Gitminal");
    expect(destroySpy).not.toHaveBeenCalled();

    await act(async () => {
      setup.mockInput.pressCtrlC();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(destroySpy).toHaveBeenCalledTimes(1);

    destroySpy.mockRestore();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("does not quit on a plain c key before or after dismissal", async () => {
    const setup = await testRender(<App checkForUpdate={checkForUpdateMock} />, {
      width: 80,
      height: 24,
      exitOnCtrlC: false,
    });
    const destroySpy = spyOn(setup.renderer, "destroy").mockImplementation(() => {});

    await act(async () => {
      await setup.renderOnce();
    });
    await act(async () => {
      setup.mockInput.pressKey("c");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(destroySpy).not.toHaveBeenCalled();
    expect(setup.captureCharFrame()).toContain("Gitminal");

    await act(async () => {
      setup.mockInput.pressKey("c");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(destroySpy).not.toHaveBeenCalled();
    expect(setup.captureCharFrame()).toContain("Gitminal");

    destroySpy.mockRestore();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("does not wait for an in-flight update check before rendering or quitting", async () => {
    const setup = await testRender(<App checkForUpdate={checkForUpdateMock} />, {
      width: 80,
      height: 24,
      exitOnCtrlC: false,
    });
    const destroySpy = spyOn(setup.renderer, "destroy").mockImplementation(() => {});

    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).toContain("Checking for updates...");
    expect(checkForUpdateMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      setup.mockInput.pressCtrlC();
    });

    expect(destroySpy).toHaveBeenCalledTimes(1);

    destroySpy.mockRestore();
    await act(async () => {
      await setup.dispose();
    });
  });
});
