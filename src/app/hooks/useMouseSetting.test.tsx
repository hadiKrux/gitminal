import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { useConfig } from "@/app/hooks/useConfig";
import { useMouseSetting } from "@/app/hooks/useMouseSetting";
import { ConfigProvider } from "@/app/providers/ConfigProvider";
import type { ConfigSnapshot, ConfigSource } from "@/app/providers/ConfigProvider.types";
import { DEFAULT_CONFIG, UNRESOLVED_CONFIG_PATHS } from "@/domain/config/config.defaults";
import type { GitminalConfig } from "@/domain/config/config.types";

/** Latest configuration context captured by the probe. */
let latestConfig: ReturnType<typeof useConfig> | undefined;

/**
 * Builds a snapshot with one mouse setting.
 *
 * @param mouse - Whether mouse reporting is enabled.
 * @returns The snapshot.
 */
function snapshot(mouse: boolean): ConfigSnapshot {
  return {
    status: "applied",
    config: { ...DEFAULT_CONFIG, ui: { mouse } },
    paths: UNRESOLVED_CONFIG_PATHS,
    files: [],
    warnings: [],
    keybindingsFile: {},
    themeOverrides: null,
  };
}

/**
 * Builds a source that returns one configuration per reload.
 *
 * @param configurations - Effective configurations to return in order.
 * @returns The source.
 */
function createSource(configurations: readonly GitminalConfig[]): ConfigSource {
  let index = 0;

  return {
    paths: UNRESOLVED_CONFIG_PATHS,
    load: async (): Promise<ConfigSnapshot> => {
      const config = configurations[index] ?? configurations.at(-1);

      index += 1;

      if (config === undefined) {
        throw new Error("no configuration configured");
      }

      return snapshot(config.ui.mouse);
    },
  };
}

/**
 * Applies the mouse setting and exposes the configuration handle.
 *
 * @returns A text marker.
 */
function MouseProbe(): ReactNode {
  useMouseSetting();
  latestConfig = useConfig();

  return <text>mouse</text>;
}

describe("useMouseSetting", () => {
  it("applies the startup value and follows a reload", async () => {
    latestConfig = undefined;

    const source = createSource([{ ...DEFAULT_CONFIG, ui: { mouse: false } }]);
    const setup = await testRender(
      <ConfigProvider initialSnapshot={snapshot(true)} source={source}>
        <MouseProbe />
      </ConfigProvider>,
      { width: 40, height: 8 },
    );

    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.renderer.useMouse).toBeTrue();

    await act(async () => {
      await latestConfig?.reload();
      await setup.renderOnce();
    });

    expect(setup.renderer.useMouse).toBeFalse();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("disables mouse reporting at mount when configuration says so", async () => {
    latestConfig = undefined;

    const setup = await testRender(
      <ConfigProvider initialSnapshot={snapshot(false)}>
        <MouseProbe />
      </ConfigProvider>,
      { width: 40, height: 8 },
    );

    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.renderer.useMouse).toBeFalse();

    await act(async () => {
      await setup.dispose();
    });
  });
});
