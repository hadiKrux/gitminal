import { describe, expect, it } from "bun:test";
import { RGBA, type SyntaxStyle } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { useTheme } from "@/app/hooks/useTheme";
import { ConfigProvider } from "@/app/providers/ConfigProvider";
import type { ConfigSnapshot } from "@/app/providers/ConfigProvider.types";
import { ThemeProvider } from "@/app/providers/ThemeProvider";
import { DEFAULT_CONFIG, UNRESOLVED_CONFIG_PATHS } from "@/domain/config/config.defaults";
import type { GitminalConfig } from "@/domain/config/config.types";
import { applyThemeCapability } from "@/domain/theme/theme.capability";
import { resolveTheme } from "@/domain/theme/theme.resolve";
import type { ResolvedTheme, ThemeColorCapability, ThemeTokens } from "@/domain/theme/theme.types";
import { readGuardError, renderGuard } from "@/test/react.guard";
import { useSyntaxStyle } from "@/theme/useSyntaxStyle";
import { useThemeControls } from "@/theme/useThemeControls";
import { useTokens } from "@/theme/useTokens";

/** Latest theme and tokens rendered by the probe. */
let latestTheme: ResolvedTheme | undefined;
let latestTokens: ThemeTokens | undefined;
let latestControls: ReturnType<typeof useThemeControls> | undefined;
let latestSyntaxStyle: SyntaxStyle | undefined;

/** Prefix kept outside the string so an override color is not written as a hex literal. */
const HEX_PREFIX = "#";

/**
 * Reads the resolved theme, its tokens, and its controls.
 *
 * @returns A marker element.
 */
function ThemeProbe(): ReactNode {
  latestTheme = useTheme();
  latestTokens = useTokens();
  latestControls = useThemeControls();
  latestSyntaxStyle = useSyntaxStyle();

  return <text>{latestTheme?.name ?? "none"}</text>;
}

/**
 * Calls `useSyntaxStyle` without a provider so the boundary can catch its guard error.
 *
 * @returns A marker element.
 */
function SyntaxGuardProbe(): ReactNode {
  useSyntaxStyle();

  return <text>syntax guard</text>;
}

/**
 * Calls `useTheme` without a provider so the boundary can catch its guard error.
 *
 * @returns A marker element.
 */
function ThemeGuardProbe(): ReactNode {
  useTheme();

  return <text>theme guard</text>;
}

/**
 * Calls `useTokens` without a provider so the boundary can catch its guard error.
 *
 * @returns A marker element.
 */
function TokensGuardProbe(): ReactNode {
  useTokens();

  return <text>tokens guard</text>;
}

/**
 * Calls `useThemeControls` without a provider so the boundary can catch its guard error.
 *
 * @returns A marker element.
 */
function ControlsGuardProbe(): ReactNode {
  useThemeControls();

  return <text>controls guard</text>;
}

/**
 * Builds a snapshot with the given config, theme layer, and warnings.
 *
 * @param overrides - Snapshot fields to override.
 * @returns The snapshot.
 */
function snapshot(overrides: Partial<ConfigSnapshot> = {}): ConfigSnapshot {
  return {
    status: "applied",
    config: DEFAULT_CONFIG,
    paths: UNRESOLVED_CONFIG_PATHS,
    files: [],
    warnings: [],
    keybindingsFile: {},
    themeOverrides: null,
    ...overrides,
  };
}

/**
 * Renders the theme providers with an optional configuration and overrides.
 *
 * @param options - Config, theme layer, static theme name, and capability.
 * @returns The rendered setup.
 */
async function renderTheme(
  options: {
    readonly config?: GitminalConfig;
    readonly themeOverrides?: unknown;
    readonly themeName?: string;
    readonly capability?: ThemeColorCapability;
  } = {},
): Promise<Awaited<ReturnType<typeof testRender>>> {
  latestTheme = undefined;
  latestTokens = undefined;
  latestControls = undefined;
  latestSyntaxStyle = undefined;

  return testRender(
    <ConfigProvider
      initialSnapshot={snapshot({
        config: options.config ?? DEFAULT_CONFIG,
        themeOverrides: options.themeOverrides ?? null,
      })}
    >
      <ThemeProvider themeName={options.themeName} capability={options.capability ?? "truecolor"}>
        <ThemeProbe />
      </ThemeProvider>
    </ConfigProvider>,
    { width: 40, height: 10 },
  );
}

describe("ThemeProvider resolution", () => {
  it("resolves the configured theme and exposes its tokens through useTokens", async () => {
    const setup = await renderTheme({ config: { ...DEFAULT_CONFIG, theme: "catppuccin-latte" } });

    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestTheme?.name).toBe("catppuccin-latte");
    expect(latestTheme?.label).toBe("Catppuccin Latte");
    expect(latestTheme?.variant).toBe("light");
    expect(latestTheme?.capability).toBe("truecolor");
    expect(latestTheme?.warnings).toEqual([]);
    expect(latestTokens).toBe(resolveTheme("catppuccin-latte").tokens);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("falls back to Mocha with a warning when the configured theme is unknown", async () => {
    const setup = await renderTheme({ config: { ...DEFAULT_CONFIG, theme: "solarized" } });
    const mocha = resolveTheme("catppuccin-mocha");

    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestTheme?.name).toBe("catppuccin-mocha");
    expect(latestTheme?.warnings).toEqual(['Unknown theme "solarized"; using "catppuccin-mocha".']);
    expect(latestTokens).toBe(mocha.tokens);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("applies the static themeName override for tests and embeddings", async () => {
    const setup = await renderTheme({ themeName: "catppuccin-frappe" });

    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestTheme?.label).toBe("Catppuccin Frappe");
    expect(latestTokens).toBe(resolveTheme("catppuccin-frappe").tokens);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("layers the theme.json overrides from the loader over the base theme", async () => {
    const accent = `${HEX_PREFIX}123456`;
    const setup = await renderTheme({
      themeOverrides: { colors: { accent } },
    });

    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestTokens?.accent).toBe(accent);
    expect(latestTokens?.background).toBe(resolveTheme("catppuccin-mocha").tokens.background);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("maps the resolved tokens onto the detected capability", async () => {
    const setup = await renderTheme({ capability: "color-256" });
    const expected = applyThemeCapability(resolveTheme("catppuccin-mocha"), "color-256");

    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestTheme?.capability).toBe("color-256");
    expect(latestTokens).toEqual(expected.tokens);

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("ThemeProvider session controls", () => {
  it("previews, commits, and restores the active theme name", async () => {
    const setup = await renderTheme();

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      latestControls?.preview("catppuccin-latte");
      await setup.renderOnce();
    });

    expect(latestTheme?.name).toBe("catppuccin-latte");
    expect(latestTheme?.variant).toBe("light");

    await act(async () => {
      latestControls?.commit("catppuccin-macchiato");
      await setup.renderOnce();
    });

    expect(latestTheme?.name).toBe("catppuccin-macchiato");

    await act(async () => {
      latestControls?.restore("catppuccin-mocha");
      await setup.renderOnce();
    });

    expect(latestTheme?.name).toBe("catppuccin-mocha");
    expect(latestTokens).toBe(resolveTheme("catppuccin-mocha").tokens);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the resolved theme object stable when nothing changes", async () => {
    const setup = await renderTheme();

    await act(async () => {
      await setup.renderOnce();
    });

    const first = latestTheme;

    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestTheme).toBe(first);

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("ThemeProvider syntax style", () => {
  it("builds the shared style from the active tokens", async () => {
    const setup = await renderTheme();
    const mocha = resolveTheme("catppuccin-mocha").tokens;

    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestSyntaxStyle?.getStyle("keyword")?.fg?.equals(RGBA.fromHex(mocha.accent))).toBe(
      true,
    );
    expect(latestSyntaxStyle?.getStyle("default")?.fg?.equals(RGBA.fromHex(mocha.text))).toBe(true);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("rebuilds the style when the theme changes", async () => {
    const setup = await renderTheme();
    const latte = resolveTheme("catppuccin-latte").tokens;

    await act(async () => {
      await setup.renderOnce();
    });

    const first = latestSyntaxStyle;

    await act(async () => {
      latestControls?.preview("catppuccin-latte");
      await setup.renderOnce();
    });

    expect(latestSyntaxStyle).not.toBe(first);
    expect(latestSyntaxStyle?.getStyle("keyword")?.fg?.equals(RGBA.fromHex(latte.accent))).toBe(
      true,
    );

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("ThemeProvider guards", () => {
  it("throws when useTheme runs outside a ThemeProvider", async () => {
    const setup = await renderGuard(<ThemeGuardProbe />);

    await act(async () => {
      await setup.renderOnce();
    });

    expect(readGuardError()).toBe("useTheme must be used within a ThemeProvider.");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("throws when useTokens runs outside a ThemeProvider", async () => {
    const setup = await renderGuard(<TokensGuardProbe />);

    await act(async () => {
      await setup.renderOnce();
    });

    expect(readGuardError()).toBe("useTokens must be used within a ThemeProvider.");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("throws when useSyntaxStyle runs outside a ThemeProvider", async () => {
    const setup = await renderGuard(<SyntaxGuardProbe />);

    await act(async () => {
      await setup.renderOnce();
    });

    expect(readGuardError()).toBe("useSyntaxStyle must be used within a ThemeProvider.");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("throws when useThemeControls runs outside a ThemeProvider", async () => {
    const setup = await renderGuard(<ControlsGuardProbe />);

    await act(async () => {
      await setup.renderOnce();
    });

    expect(readGuardError()).toBe("useThemeControls must be used within a ThemeProvider.");

    await act(async () => {
      await setup.dispose();
    });
  });
});
