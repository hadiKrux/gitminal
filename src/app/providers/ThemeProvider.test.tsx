import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { useTheme } from "@/app/hooks/useTheme";
import { ConfigProvider } from "@/app/providers/ConfigProvider";
import { ThemeProvider } from "@/app/providers/ThemeProvider";
import { DEFAULT_CONFIG } from "@/domain/config/config.defaults";
import type { GitminalConfig } from "@/domain/config/config.types";
import { resolveTheme } from "@/domain/theme/theme.resolve";
import type { ResolvedTheme, ThemeTokens } from "@/domain/theme/theme.types";
import { readGuardError, renderGuard } from "@/test/react.guard";
import { useTokens } from "@/theme/useTokens";

/** Latest theme and tokens rendered by the probe. */
let latestTheme: ResolvedTheme | undefined;
let latestTokens: ThemeTokens | undefined;

/**
 * Reads both the resolved theme and the token hook value.
 *
 * @returns A marker element.
 */
function ThemeProbe(): ReactNode {
  latestTheme = useTheme();
  latestTokens = useTokens();

  return <text>theme</text>;
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
 * Renders the theme providers with an optional configuration and theme override.
 *
 * @param config - Effective configuration.
 * @param themeName - Static theme override passed to `ThemeProvider`.
 * @returns The rendered setup.
 */
async function renderTheme(
  config: GitminalConfig = DEFAULT_CONFIG,
  themeName?: string,
): Promise<Awaited<ReturnType<typeof testRender>>> {
  latestTheme = undefined;
  latestTokens = undefined;

  return testRender(
    <ConfigProvider initialConfig={config}>
      <ThemeProvider themeName={themeName}>
        <ThemeProbe />
      </ThemeProvider>
    </ConfigProvider>,
    { width: 40, height: 10 },
  );
}

describe("ThemeProvider", () => {
  it("resolves the configured theme and exposes its tokens through useTokens", async () => {
    const setup = await renderTheme({ ...DEFAULT_CONFIG, theme: "catppuccin-latte" });

    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestTheme?.name).toBe("catppuccin-latte");
    expect(latestTheme?.label).toBe("Catppuccin Latte");
    expect(latestTheme?.warnings).toEqual([]);
    expect(latestTokens).toBe(resolveTheme("catppuccin-latte").tokens);
    expect(latestTokens?.background).toBe(resolveTheme("catppuccin-latte").tokens.background);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("falls back to Mocha with a warning when the configured theme is unknown", async () => {
    const setup = await renderTheme({ ...DEFAULT_CONFIG, theme: "solarized" });
    const mocha = resolveTheme("catppuccin-mocha");

    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestTheme?.name).toBe("catppuccin-mocha");
    expect(latestTheme?.label).toBe("Catppuccin Mocha");
    expect(latestTheme?.warnings).toEqual(['Unknown theme "solarized"; using "catppuccin-mocha".']);
    expect(latestTokens).toBe(mocha.tokens);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("applies the static themeName override for tests and embeddings", async () => {
    const setup = await renderTheme(DEFAULT_CONFIG, "catppuccin-frappe");

    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestTheme?.label).toBe("Catppuccin Frappe");
    expect(latestTokens).toBe(resolveTheme("catppuccin-frappe").tokens);

    await act(async () => {
      await setup.dispose();
    });
  });

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
});
