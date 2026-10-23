import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { useConfig } from "@/app/hooks/useConfig";
import { ConfigProvider } from "@/app/providers/ConfigProvider";
import type { ConfigContextValue } from "@/app/providers/ConfigProvider.types";
import { DEFAULT_CONFIG, UNRESOLVED_CONFIG_PATHS } from "@/domain/config/config.defaults";
import { readGuardError, renderGuard } from "@/test/react.guard";

/** Latest context value rendered by the probe. */
let latest: ConfigContextValue | undefined;

/**
 * Reads the latest context value captured by the probe.
 *
 * @returns The rendered context value.
 */
function readLatest(): ConfigContextValue | undefined {
  return latest;
}

/**
 * Renders the config context value and captures it for assertions.
 *
 * @returns A marker element.
 */
function ConfigProbe(): ReactNode {
  latest = useConfig();

  return <text>config</text>;
}

/**
 * Calls `useConfig` without a provider so the boundary can catch its guard error.
 *
 * @returns A marker element.
 */
function ConfigGuardProbe(): ReactNode {
  useConfig();

  return <text>config guard</text>;
}

describe("ConfigProvider", () => {
  it("provides the built-in configuration and unresolved paths by default", async () => {
    latest = undefined;
    const setup = await testRender(
      <ConfigProvider>
        <ConfigProbe />
      </ConfigProvider>,
      { width: 40, height: 10 },
    );

    await act(async () => {
      await setup.renderOnce();
    });

    expect(readLatest()?.config).toBe(DEFAULT_CONFIG);
    expect(readLatest()?.paths).toBe(UNRESOLVED_CONFIG_PATHS);
    expect(readLatest()?.warnings).toEqual([]);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("exposes injected configuration, paths, and warnings", async () => {
    latest = undefined;
    const config = { ...DEFAULT_CONFIG, theme: "catppuccin-latte" };
    const paths = {
      config: "/tmp/gitminal/config.json",
      keybindings: "/tmp/gitminal/keybindings.json",
      theme: "/tmp/gitminal/theme.json",
    };
    const setup = await testRender(
      <ConfigProvider initialConfig={config} initialPaths={paths} initialWarnings={["warning"]}>
        <ConfigProbe />
      </ConfigProvider>,
      { width: 40, height: 10 },
    );

    await act(async () => {
      await setup.renderOnce();
    });

    expect(readLatest()?.config).toBe(config);
    expect(readLatest()?.paths).toBe(paths);
    expect(readLatest()?.warnings).toEqual(["warning"]);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("throws when useConfig runs outside a ConfigProvider", async () => {
    const setup = await renderGuard(<ConfigGuardProbe />);

    await act(async () => {
      await setup.renderOnce();
    });

    expect(readGuardError()).toBe("useConfig must be used within a ConfigProvider.");

    await act(async () => {
      await setup.dispose();
    });
  });
});
