import { beforeEach, describe, expect, it, mock } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { registerAction, resetActionRegistry, resolveActionHandler } from "@/app/hooks/useAction";
import { useHotkeys } from "@/app/hooks/useHotkeys";
import { useThemePickerAction } from "@/app/hooks/useThemePickerAction";
import type { ConfigSnapshot } from "@/app/providers/ConfigProvider.types";
import { DEFAULT_CONFIG, UNRESOLVED_CONFIG_PATHS } from "@/domain/config/config.defaults";
import { OverlayHost } from "@/features/overlays/OverlayHost";
import { AppTestProviders } from "@/test/app.harness";
import { createFakeGitClient } from "@/test/git.fake";

/** Snapshot with no configuration files, so the picker has nothing to persist. */
const SNAPSHOT: ConfigSnapshot = {
  status: "missing",
  config: DEFAULT_CONFIG,
  paths: UNRESOLVED_CONFIG_PATHS,
  files: Object.freeze([]),
  warnings: Object.freeze([]),
  keybindingsFile: Object.freeze({}),
  themeOverrides: null,
};

/**
 * Registers the app-level theme picker action and renders the overlay host.
 *
 * @returns The harness layout.
 */
function ActionHarness(): ReactNode {
  useThemePickerAction();
  useHotkeys();

  return <OverlayHost />;
}

/**
 * Renders the app-level theme picker action harness.
 *
 * @returns The renderer setup.
 */
async function renderHarness(): Promise<Awaited<ReturnType<typeof testRender>>> {
  const setup = await testRender(
    <AppTestProviders configSnapshot={SNAPSHOT} gitClient={createFakeGitClient().client}>
      <ActionHarness />
    </AppTestProviders>,
    { width: 80, height: 24, kittyKeyboard: true },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

beforeEach(() => {
  resetActionRegistry();
});

describe("useThemePickerAction", () => {
  it("registers app.themePicker once as a global app action", async () => {
    const setup = await renderHarness();

    expect(resolveActionHandler("app.themePicker", "global")).toBeDefined();
    expect(resolveActionHandler("app.themePicker", "overlay")).toBeUndefined();

    await act(async () => {
      await setup.dispose();
    });

    expect(resolveActionHandler("app.themePicker", "global")).toBeUndefined();
  });

  it("rejects a duplicate global registration and keeps the first handler", async () => {
    const setup = await renderHarness();
    const consoleError = mock(() => {});
    const originalError = console.error;
    const first = resolveActionHandler("app.themePicker", "global");

    console.error = consoleError;

    try {
      const cleanup = registerAction(
        "app.themePicker",
        { scope: "global", owner: "app" },
        () => {},
      );

      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(resolveActionHandler("app.themePicker", "global")).toBe(first);

      cleanup();
      expect(resolveActionHandler("app.themePicker", "global")).toBe(first);
    } finally {
      console.error = originalError;
    }

    await act(async () => {
      await setup.dispose();
    });
  });

  it("opens the picker as the single open overlay entry", async () => {
    const setup = await renderHarness();

    await act(async () => {
      resolveActionHandler("app.themePicker", "global")?.();
      await setup.renderOnce();
    });

    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();

    expect(frame).toContain("Theme");
    expect(frame).toContain("Catppuccin Mocha");
    expect(resolveActionHandler("nav.up", "overlay")).toBeDefined();
    expect(resolveActionHandler("overlay.close", "overlay")).toBeDefined();

    await act(async () => {
      resolveActionHandler("overlay.close", "overlay")?.();
      await setup.renderOnce();
    });

    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).not.toContain("Catppuccin Mocha");

    await act(async () => {
      await setup.dispose();
    });
  });
});
