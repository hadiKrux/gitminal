import { beforeEach, describe, expect, it, mock } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode, useState } from "react";
import { resetActionRegistry, resolveActionHandler } from "@/app/hooks/useAction";
import { useTheme } from "@/app/hooks/useTheme";
import { DEFAULT_CONFIG, UNRESOLVED_CONFIG_PATHS } from "@/domain/config/config.defaults";
import type { ThemeWriteResult } from "@/domain/config/config.types";
import type { ResolvedTheme, ThemeColorCapability } from "@/domain/theme/theme.types";
import { ThemePicker } from "@/features/theme-picker/ThemePicker";
import { themeRowId } from "@/features/theme-picker/ThemeRow";
import { AppTestProviders } from "@/test/app.harness";
import { createFakeGitClient } from "@/test/git.fake";

/** Snapshot type the harness accepts; derived here so this test imports no app module. */
type TestConfigSnapshot = NonNullable<Parameters<typeof AppTestProviders>[0]["configSnapshot"]>;

/** Snapshot without a theme file, so the override note is absent. */
const PLAIN_SNAPSHOT: TestConfigSnapshot = {
  status: "applied",
  config: DEFAULT_CONFIG,
  paths: UNRESOLVED_CONFIG_PATHS,
  files: Object.freeze([]),
  warnings: Object.freeze([]),
  keybindingsFile: Object.freeze({}),
  themeOverrides: null,
};

/** Snapshot with a theme file, so the override note is present. */
const OVERRIDE_SNAPSHOT: TestConfigSnapshot = {
  ...PLAIN_SNAPSHOT,
  paths: Object.freeze({
    config: "/cfg/config.json",
    keybindings: null,
    theme: "/cfg/theme.json",
  }),
  files: Object.freeze([
    { key: "theme", status: "loaded", value: { colors: {} }, path: "/cfg/theme.json" },
  ]),
  themeOverrides: { colors: {} },
};

/** Latest resolved theme captured by the watcher. */
let latestTheme: ResolvedTheme | undefined;

/**
 * Reads the latest captured theme.
 *
 * A function read keeps TypeScript from narrowing the module variable to `undefined` after a reset,
 * which would hide assignments made inside render callbacks.
 *
 * @returns The latest resolved theme, or undefined before the first render.
 */
function readLatestTheme(): ResolvedTheme | undefined {
  return latestTheme;
}

/** Hides the picker without closing it, used by the unmount-restore test. */
let hidePicker: () => void = () => {};

/**
 * Captures the resolved theme without rendering any visible content.
 *
 * @returns An empty marker.
 */
function ThemeWatcher(): ReactNode {
  latestTheme = useTheme();

  return <text> </text>;
}

/**
 * Renders the picker behind local visibility state so a test can unmount it without closing.
 *
 * @param props - Close handler and persistence override.
 * @returns The picker while visible plus the theme watcher.
 */
function UnmountablePicker(props: {
  readonly onClose: () => void;
  readonly persist?: (name: string, configPath: string | null) => Promise<ThemeWriteResult>;
}): ReactNode {
  const [visible, setVisible] = useState(true);

  hidePicker = (): void => {
    setVisible(false);
  };

  return (
    <>
      {visible ? <ThemePicker onClose={props.onClose} persist={props.persist} /> : null}
      <ThemeWatcher />
    </>
  );
}

/**
 * Renders the picker with an optional close handler, persistence, snapshot, and capability.
 *
 * @param options - Case inputs.
 * @returns The rendered setup and the close mock.
 */
async function renderPicker(
  options: {
    readonly onClose?: () => void;
    readonly persist?: (name: string, configPath: string | null) => Promise<ThemeWriteResult>;
    readonly snapshot?: TestConfigSnapshot;
    readonly capability?: ThemeColorCapability;
  } = {},
): Promise<{
  readonly setup: Awaited<ReturnType<typeof testRender>>;
  readonly onClose: () => void;
}> {
  const onClose = options.onClose ?? mock(() => {});

  latestTheme = undefined;

  const setup = await testRender(
    <AppTestProviders
      configSnapshot={options.snapshot ?? PLAIN_SNAPSHOT}
      capability={options.capability}
      gitClient={createFakeGitClient().client}
    >
      <ThemePicker onClose={onClose} persist={options.persist} />
      <ThemeWatcher />
    </AppTestProviders>,
    { width: 80, height: 24 },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  return { setup, onClose };
}

/**
 * Resolves one overlay-scoped action and flushes the renders it causes.
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

describe("ThemePicker rendering", () => {
  it("renders a custom row per flavor with names, variants, and the active marker", async () => {
    const { setup } = await renderPicker();
    const frame = setup.captureCharFrame();

    for (const id of [
      themeRowId("catppuccin-mocha"),
      themeRowId("catppuccin-macchiato"),
      themeRowId("catppuccin-frappe"),
      themeRowId("catppuccin-latte"),
    ]) {
      expect(setup.renderer.root.findDescendantById(id), id).toBeDefined();
    }

    expect(frame).toContain("Theme");
    expect(frame).toContain("Catppuccin Mocha");
    expect(frame).toContain("Catppuccin Macchiato");
    expect(frame).toContain("Catppuccin Frappe");
    expect(frame).toContain("Catppuccin Latte");
    expect(frame).toContain("dark");
    expect(frame).toContain("light");
    expect(frame).toContain("*");
    expect(frame).toContain("Cancel");
    expect(frame).toContain("Apply");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("falls back to plain swatch markers without color", async () => {
    const { setup } = await renderPicker({ capability: "monochrome" });
    const frame = setup.captureCharFrame();

    expect(frame).toContain("[#]");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows the theme.json note only when the file is present", async () => {
    const plain = await renderPicker();

    expect(plain.setup.captureCharFrame()).not.toContain("theme.json overrides");

    await act(async () => {
      await plain.setup.dispose();
    });

    const withOverrides = await renderPicker({ snapshot: OVERRIDE_SNAPSHOT });

    expect(withOverrides.setup.captureCharFrame()).toContain("theme.json overrides");

    await act(async () => {
      await withOverrides.setup.dispose();
    });
  });
});

describe("ThemePicker interaction", () => {
  it("previews live on nav.down and nav.up", async () => {
    const { setup } = await renderPicker();

    await runOverlayAction(setup, "nav.down");
    expect(latestTheme?.name).toBe("catppuccin-macchiato");

    await runOverlayAction(setup, "nav.down");
    expect(latestTheme?.name).toBe("catppuccin-frappe");

    await runOverlayAction(setup, "nav.up");
    expect(latestTheme?.name).toBe("catppuccin-macchiato");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("restores the previous theme when it unmounts without closing", async () => {
    latestTheme = undefined;
    hidePicker = () => {};

    const setup = await testRender(
      <AppTestProviders
        configSnapshot={PLAIN_SNAPSHOT}
        capability="truecolor"
        gitClient={createFakeGitClient().client}
      >
        <UnmountablePicker onClose={() => {}} />
      </AppTestProviders>,
      { width: 80, height: 24 },
    );

    await act(async () => {
      await setup.renderOnce();
    });

    await runOverlayAction(setup, "nav.down");

    expect(readLatestTheme()?.name).toBe("catppuccin-macchiato");

    await act(async () => {
      hidePicker();
      await setup.renderOnce();
    });

    expect(readLatestTheme()?.name).toBe("catppuccin-mocha");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("moves between the rows and the actions with focus.next and focus.previous", async () => {
    const { setup, onClose } = await renderPicker();

    await runOverlayAction(setup, "focus.next");
    await runOverlayAction(setup, "nav.up");
    await runOverlayAction(setup, "nav.activate");

    expect(latestTheme?.name).toBe("catppuccin-mocha");
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => {
      await setup.dispose();
    });

    const second = await renderPicker();

    await runOverlayAction(second.setup, "focus.next");
    await runOverlayAction(second.setup, "focus.previous");
    await runOverlayAction(second.setup, "nav.down");

    expect(latestTheme?.name).toBe("catppuccin-macchiato");

    await act(async () => {
      await second.setup.dispose();
    });
  });

  it("applies and closes on nav.activate", async () => {
    const persist = mock(async (): Promise<ThemeWriteResult> => ({ ok: true }));
    const { setup, onClose } = await renderPicker({ persist });

    await runOverlayAction(setup, "nav.down");
    await runOverlayAction(setup, "nav.activate");

    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith("catppuccin-macchiato", null);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(latestTheme?.name).toBe("catppuccin-macchiato");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("restores the previous theme on overlay.close", async () => {
    const persist = mock(async (): Promise<ThemeWriteResult> => ({ ok: true }));
    const { setup, onClose } = await renderPicker({ persist });

    await runOverlayAction(setup, "nav.down");
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

describe("ThemePicker handler ownership", () => {
  it("registers only overlay-scoped handlers", async () => {
    const { setup } = await renderPicker();

    for (const actionId of [
      "nav.up",
      "nav.down",
      "nav.activate",
      "overlay.close",
      "focus.next",
      "focus.previous",
    ]) {
      expect(resolveActionHandler(actionId, "overlay"), actionId).toBeDefined();
    }

    expect(resolveActionHandler("app.themePicker", "global")).toBeUndefined();
    expect(resolveActionHandler("app.themePicker", "overlay")).toBeUndefined();

    await act(async () => {
      await setup.dispose();
    });

    expect(resolveActionHandler("nav.up", "overlay")).toBeUndefined();
  });
});
