import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { useConfig } from "@/app/hooks/useConfig";
import { ConfigProvider } from "@/app/providers/ConfigProvider";
import type {
  ConfigContextValue,
  ConfigSnapshot,
  ConfigSource,
} from "@/app/providers/ConfigProvider.types";
import { DEFAULT_CONFIG, UNRESOLVED_CONFIG_PATHS } from "@/domain/config/config.defaults";
import type { ConfigFilePaths, GitminalConfig } from "@/domain/config/config.types";
import { readGuardError, renderGuard } from "@/test/react.guard";

/** Paths used by the reload cases. */
const PATHS: ConfigFilePaths = Object.freeze({
  config: "/cfg/config.json",
  keybindings: "/cfg/keybindings.json",
  theme: "/cfg/theme.json",
});

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
 * Builds a snapshot with sensible defaults.
 *
 * @param overrides - Fields to override.
 * @returns The snapshot.
 */
function snapshot(overrides: Partial<ConfigSnapshot> = {}): ConfigSnapshot {
  return {
    status: "applied",
    config: DEFAULT_CONFIG,
    paths: PATHS,
    files: Object.freeze([]),
    warnings: Object.freeze([]),
    keybindingsFile: Object.freeze({}),
    themeOverrides: null,
    ...overrides,
  };
}

/**
 * Builds a source that returns one snapshot per reload and records the previous configuration.
 *
 * @param loads - Snapshots or errors to return in order.
 * @returns The source and the recorded `previous` arguments.
 */
function createSource(loads: readonly (ConfigSnapshot | Error)[]): {
  readonly source: ConfigSource;
  readonly previous: (GitminalConfig | undefined)[];
} {
  const previous: (GitminalConfig | undefined)[] = [];
  let index = 0;

  return {
    previous,
    source: {
      paths: PATHS,
      load: async (current?: GitminalConfig): Promise<ConfigSnapshot> => {
        previous.push(current);

        const load = loads[index] ?? loads.at(-1);
        index += 1;

        if (load === undefined) {
          throw new Error("no load configured");
        }

        if (load instanceof Error) {
          throw load;
        }

        return load;
      },
    },
  };
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

/**
 * Renders the config provider with the given props.
 *
 * @param props - Provider props under test.
 * @returns The rendered setup.
 */
async function renderConfig(
  props: {
    readonly initialSnapshot?: ConfigSnapshot;
    readonly source?: ConfigSource;
    readonly initialConfig?: GitminalConfig;
    readonly initialPaths?: ConfigFilePaths;
    readonly initialWarnings?: readonly string[];
  } = {},
): Promise<Awaited<ReturnType<typeof testRender>>> {
  latest = undefined;

  return testRender(
    <ConfigProvider {...props}>
      <ConfigProbe />
    </ConfigProvider>,
    { width: 40, height: 10 },
  );
}

describe("ConfigProvider defaults", () => {
  it("provides the built-in configuration and unresolved paths by default", async () => {
    const setup = await renderConfig();

    await act(async () => {
      await setup.renderOnce();
    });

    expect(readLatest()?.config).toBe(DEFAULT_CONFIG);
    expect(readLatest()?.paths).toBe(UNRESOLVED_CONFIG_PATHS);
    expect(readLatest()?.warnings).toEqual([]);
    expect(readLatest()?.files).toEqual([]);
    expect(readLatest()?.keybindingsFile).toEqual({});
    expect(readLatest()?.themeOverrides).toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("exposes injected configuration, paths, and warnings", async () => {
    const config = { ...DEFAULT_CONFIG, theme: "catppuccin-latte" };
    const paths = {
      config: "/tmp/gitminal/config.json",
      keybindings: "/tmp/gitminal/keybindings.json",
      theme: "/tmp/gitminal/theme.json",
    };
    const setup = await renderConfig({
      initialConfig: config,
      initialPaths: paths,
      initialWarnings: ["warning"],
    });

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

  it("exposes a startup snapshot with per-file load status and the theme layer", async () => {
    const themeOverrides = { colors: {} };
    const startup = snapshot({
      config: { ...DEFAULT_CONFIG, theme: "catppuccin-frappe" },
      files: Object.freeze([
        { key: "config" as const, status: "loaded" as const, value: {}, path: PATHS.config },
        { key: "keybindings" as const, status: "missing" as const, value: null, path: null },
        {
          key: "theme" as const,
          status: "loaded" as const,
          value: themeOverrides,
          path: PATHS.theme,
        },
      ]),
      warnings: Object.freeze(["one warning"]),
      keybindingsFile: Object.freeze({ "app.refresh": ["x"] }),
      themeOverrides,
    });
    const setup = await renderConfig({ initialSnapshot: startup });

    await act(async () => {
      await setup.renderOnce();
    });

    expect(readLatest()?.config.theme).toBe("catppuccin-frappe");
    expect(readLatest()?.files.map((file) => file.status)).toEqual(["loaded", "missing", "loaded"]);
    expect(readLatest()?.warnings).toEqual(["one warning"]);
    expect(readLatest()?.keybindingsFile).toEqual({ "app.refresh": ["x"] });
    expect(readLatest()?.themeOverrides).toBe(themeOverrides);

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("ConfigProvider reload", () => {
  it("applies a valid reload in place and passes the previous configuration", async () => {
    const startup = snapshot();
    const reloaded = snapshot({
      config: { ...DEFAULT_CONFIG, theme: "catppuccin-latte" },
      warnings: Object.freeze(["a warning"]),
    });
    const { source, previous } = createSource([reloaded]);
    const setup = await renderConfig({ initialSnapshot: startup, source });

    await act(async () => {
      await setup.renderOnce();
    });

    let result: Awaited<ReturnType<ConfigContextValue["reload"]>> | undefined;

    await act(async () => {
      result = await readLatest()?.reload();
      await setup.renderOnce();
    });

    expect(result).toEqual({ ok: true, warnings: ["a warning"] });
    expect(previous).toEqual([startup.config]);
    expect(readLatest()?.config.theme).toBe("catppuccin-latte");
    expect(readLatest()?.warnings).toEqual(["a warning"]);
    expect(readLatest()?.paths).toBe(PATHS);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the previous effective configuration when the file is rejected", async () => {
    const startup = snapshot({ config: { ...DEFAULT_CONFIG, theme: "catppuccin-frappe" } });
    const rejected = snapshot({
      status: "rejected",
      config: DEFAULT_CONFIG,
      warnings: Object.freeze(["Unsupported version 2 in config.json; the file was ignored."]),
      keybindingsFile: Object.freeze({}),
      themeOverrides: { colors: {} },
    });
    const { source } = createSource([rejected]);
    const setup = await renderConfig({ initialSnapshot: startup, source });

    await act(async () => {
      await setup.renderOnce();
    });

    let result: Awaited<ReturnType<ConfigContextValue["reload"]>> | undefined;

    await act(async () => {
      result = await readLatest()?.reload();
      await setup.renderOnce();
    });

    expect(result).toEqual({
      ok: false,
      warnings: ["Unsupported version 2 in config.json; the file was ignored."],
    });
    expect(readLatest()?.config.theme).toBe("catppuccin-frappe");
    expect(readLatest()?.themeOverrides).toBeNull();
    expect(readLatest()?.warnings).toEqual([
      "Unsupported version 2 in config.json; the file was ignored.",
    ]);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("reports a thrown loader as a warning and keeps the previous configuration", async () => {
    const startup = snapshot({ config: { ...DEFAULT_CONFIG, theme: "catppuccin-latte" } });
    const { source } = createSource([new Error("disk on fire")]);
    const setup = await renderConfig({ initialSnapshot: startup, source });

    await act(async () => {
      await setup.renderOnce();
    });

    let result: Awaited<ReturnType<ConfigContextValue["reload"]>> | undefined;

    await act(async () => {
      result = await readLatest()?.reload();
      await setup.renderOnce();
    });

    expect(result?.ok).toBe(false);
    expect(result?.warnings[0]).toContain("disk on fire");
    expect(readLatest()?.config.theme).toBe("catppuccin-latte");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("resolves a reload without a source without changing anything", async () => {
    const setup = await renderConfig();

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      expect(await readLatest()?.reload()).toEqual({ ok: true, warnings: [] });
    });

    expect(readLatest()?.config).toBe(DEFAULT_CONFIG);

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("ConfigProvider guard", () => {
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
