import { beforeEach, describe, expect, it, mock } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { resetActionRegistry, resolveActionHandler } from "@/app/hooks/useAction";
import { useConsoleLog } from "@/app/hooks/useConsoleLog";
import { useStatus } from "@/app/hooks/useStatus";
import { useTheme } from "@/app/hooks/useTheme";
import { DEFAULT_CONFIG } from "@/domain/config/config.defaults";
import type { ConfigFilePaths, ThemeWriteResult } from "@/domain/config/config.types";
import { applyThemeCapability } from "@/domain/theme/theme.capability";
import { THEME_FLAVORS } from "@/domain/theme/theme.catppuccin";
import type { ResolvedTheme } from "@/domain/theme/theme.types";
import { THEME_SAVE_FAILED_MESSAGE } from "@/features/theme-picker/ThemePicker.constants";
import { useThemePicker } from "@/features/theme-picker/useThemePicker";
import type { ThemePersist, ThemePickerHandle } from "@/features/theme-picker/useThemePicker.types";
import { AppTestProviders } from "@/test/app.harness";
import { createFakeGitClient } from "@/test/git.fake";

/** Snapshot type the test harness accepts; derived here so the test imports no app module. */
type TestConfigSnapshot = NonNullable<Parameters<typeof AppTestProviders>[0]["configSnapshot"]>;

/** Config path the picker is expected to persist to. */
const CONFIG_PATH = "/cfg/config.json";

/** Paths that make the picker resolve a real persistence target. */
const PATHS: ConfigFilePaths = Object.freeze({
  config: CONFIG_PATH,
  keybindings: "/cfg/keybindings.json",
  theme: "/cfg/theme.json",
});

/** Snapshot that reports a present theme file so the note has something to describe. */
const SNAPSHOT: TestConfigSnapshot = {
  status: "applied",
  config: { ...DEFAULT_CONFIG },
  paths: PATHS,
  files: Object.freeze([
    { key: "theme", status: "loaded", value: { colors: {} }, path: "/cfg/theme.json" },
  ]),
  warnings: Object.freeze([]),
  keybindingsFile: Object.freeze({}),
  themeOverrides: { colors: {} },
};

/** Latest picker handle, theme, and status captured by the probe. */
let latestPicker: ThemePickerHandle | undefined;
let latestTheme: ResolvedTheme | undefined;
let latestStatus: ReturnType<typeof useStatus> | undefined;
let latestConsole: ReturnType<typeof useConsoleLog> | undefined;

/**
 * Renders the picker hook and captures its state.
 *
 * @param props - Close callback and persistence override.
 * @returns A marker element.
 */
function PickerProbe(props: {
  readonly onClose: () => void;
  readonly persist?: ThemePersist;
}): ReactNode {
  latestPicker = useThemePicker(props);
  latestTheme = useTheme();
  latestStatus = useStatus();
  latestConsole = useConsoleLog();

  return <text>{latestTheme.name}</text>;
}

/**
 * Renders the picker hook inside the provider stack.
 *
 * @param persist - Persistence override used by the case.
 * @param capability - Capability override used by the case.
 * @returns The rendered setup and the close mock.
 */
async function renderPicker(
  persist?: ThemePersist,
  capability?: "truecolor" | "color-256" | "monochrome",
): Promise<{
  readonly setup: Awaited<ReturnType<typeof testRender>>;
  readonly onClose: () => void;
}> {
  const onClose = mock(() => {});

  latestPicker = undefined;
  latestTheme = undefined;
  latestStatus = undefined;
  latestConsole = undefined;

  const setup = await testRender(
    <AppTestProviders
      configSnapshot={SNAPSHOT}
      capability={capability}
      gitClient={createFakeGitClient().client}
    >
      <PickerProbe onClose={onClose} persist={persist} />
    </AppTestProviders>,
    { width: 60, height: 20 },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  return { setup, onClose };
}

/**
 * Runs one overlay-scoped action and flushes the renders it causes.
 *
 * Two render passes are awaited because a persistence promise settles in a microtask, so the status
 * it sets only reaches the probe on the following pass.
 *
 * @param setup - Renderer setup.
 * @param actionId - Action to resolve in the overlay scope.
 */
async function runOverlayAction(
  setup: Awaited<ReturnType<typeof testRender>>,
  actionId: string,
): Promise<void> {
  await act(async () => {
    resolveActionHandler(actionId, "overlay")?.();
    await setup.renderOnce();
    await setup.renderOnce();
  });
}

beforeEach(() => {
  resetActionRegistry();
});

describe("useThemePicker rows", () => {
  it("lists the four flavors with the active one marked", async () => {
    const { setup } = await renderPicker();

    expect(latestPicker?.rows.map((row) => row.name)).toEqual([
      "catppuccin-mocha",
      "catppuccin-macchiato",
      "catppuccin-frappe",
      "catppuccin-latte",
    ]);
    expect(latestPicker?.rows.map((row) => row.variant)).toEqual(["dark", "dark", "dark", "light"]);
    expect(latestPicker?.rows.filter((row) => row.active).map((row) => row.name)).toEqual([
      "catppuccin-mocha",
    ]);
    expect(latestPicker?.highlightedIndex).toBe(0);
    expect(latestPicker?.focusedControl).toBe("apply");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("previews the quantized color on a 256-color terminal", async () => {
    const { setup } = await renderPicker(undefined, "color-256");
    const mocha = latestPicker?.rows.find((row) => row.name === "catppuccin-mocha");
    const mapped = applyThemeCapability(
      { ...THEME_FLAVORS["catppuccin-mocha"], capability: "truecolor", warnings: [] },
      "color-256",
    );

    expect(mocha?.swatchColor).toBe(mapped.tokens.background);
    expect(mocha?.swatchColor).not.toBe(THEME_FLAVORS["catppuccin-mocha"].tokens.background);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("drops the swatch color when the terminal has no color", async () => {
    const { setup } = await renderPicker(undefined, "monochrome");

    expect(latestPicker?.rows.every((row) => row.swatchColor === null)).toBe(true);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("reports the theme.json note when the file is present", async () => {
    const { setup } = await renderPicker();

    expect(latestPicker?.note).toContain("theme.json overrides");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("offers Cancel and Apply with the rows focused first", async () => {
    const { setup } = await renderPicker();

    expect(latestPicker?.actions.map((action) => action.label)).toEqual(["Cancel", "Apply"]);
    expect(latestPicker?.focusedZone).toBe("rows");
    expect(latestPicker?.actions.map((action) => action.focused)).toEqual([false, false]);

    await runOverlayAction(setup, "focus.next");

    expect(latestPicker?.focusedZone).toBe("actions");
    expect(latestPicker?.actions.map((action) => action.focused)).toEqual([false, true]);

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("useThemePicker preview", () => {
  it("previews a selected row without persisting it", async () => {
    const persist = mock(async (): Promise<ThemeWriteResult> => ({ ok: true }));
    const { setup } = await renderPicker(persist);

    await act(async () => {
      latestPicker?.select(3);
      await setup.renderOnce();
    });

    expect(latestTheme?.name).toBe("catppuccin-latte");
    expect(latestPicker?.highlightedIndex).toBe(3);
    expect(latestPicker?.rows.find((row) => row.active)?.name).toBe("catppuccin-latte");
    expect(persist).not.toHaveBeenCalled();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("previews on nav.up and nav.down", async () => {
    const { setup } = await renderPicker();

    await runOverlayAction(setup, "nav.down");
    expect(latestPicker?.highlightedIndex).toBe(1);
    expect(latestTheme?.name).toBe("catppuccin-macchiato");

    await runOverlayAction(setup, "nav.up");
    expect(latestPicker?.highlightedIndex).toBe(0);
    expect(latestTheme?.name).toBe("catppuccin-mocha");

    await runOverlayAction(setup, "nav.up");
    expect(latestPicker?.highlightedIndex).toBe(0);

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("useThemePicker apply", () => {
  it("applies, persists, and closes on nav.activate", async () => {
    const persist = mock(async (): Promise<ThemeWriteResult> => ({ ok: true }));
    const { setup, onClose } = await renderPicker(persist);

    await runOverlayAction(setup, "nav.down");
    await runOverlayAction(setup, "nav.activate");

    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith("catppuccin-macchiato", CONFIG_PATH);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(latestTheme?.name).toBe("catppuccin-macchiato");
    expect(latestStatus?.status).toEqual({
      kind: "success",
      message: "Theme saved: Catppuccin Macchiato",
    });
    expect(latestConsole?.entries).toEqual([]);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the theme for the session and warns when the write fails", async () => {
    const persist = mock(async (): Promise<ThemeWriteResult> => ({ ok: false, reason: "EACCES" }));
    const { setup, onClose } = await renderPicker(persist);

    await act(async () => {
      latestPicker?.select(3);
      await setup.renderOnce();
    });

    await runOverlayAction(setup, "nav.activate");

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(latestTheme?.name).toBe("catppuccin-latte");
    expect(latestStatus?.status).toEqual({ kind: "warning", message: THEME_SAVE_FAILED_MESSAGE });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("cancels through the focused Cancel control", async () => {
    const persist = mock(async (): Promise<ThemeWriteResult> => ({ ok: true }));
    const { setup, onClose } = await renderPicker(persist);

    await act(async () => {
      latestPicker?.select(2);
      await setup.renderOnce();
    });

    await runOverlayAction(setup, "nav.left");
    expect(latestPicker?.focusedControl).toBe("cancel");

    await runOverlayAction(setup, "nav.activate");

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(persist).not.toHaveBeenCalled();
    expect(latestTheme?.name).toBe("catppuccin-mocha");

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("useThemePicker restore", () => {
  it("restores the previous theme on overlay.close", async () => {
    const persist = mock(async (): Promise<ThemeWriteResult> => ({ ok: true }));
    const { setup, onClose } = await renderPicker(persist);

    await act(async () => {
      latestPicker?.select(1);
      await setup.renderOnce();
    });

    expect(latestTheme?.name).toBe("catppuccin-macchiato");

    await runOverlayAction(setup, "overlay.close");

    expect(latestTheme?.name).toBe("catppuccin-mocha");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(persist).not.toHaveBeenCalled();

    await act(async () => {
      await setup.dispose();
    });
  });
});
