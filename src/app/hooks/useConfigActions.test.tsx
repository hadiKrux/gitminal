import { beforeEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { resetActionRegistry, resolveActionHandler } from "@/app/hooks/useAction";
import { useConfigActions } from "@/app/hooks/useConfigActions";
import { useConsoleLog } from "@/app/hooks/useConsoleLog";
import { useStatus } from "@/app/hooks/useStatus";
import { ConfigProvider } from "@/app/providers/ConfigProvider";
import type { ConfigSnapshot, ConfigSource } from "@/app/providers/ConfigProvider.types";
import { ConsoleProvider } from "@/app/providers/ConsoleProvider";
import { StatusProvider } from "@/app/providers/StatusProvider";
import type { TransientStatus } from "@/app/providers/StatusProvider.types";
import { ThemeProvider } from "@/app/providers/ThemeProvider";
import { DEFAULT_CONFIG, UNRESOLVED_CONFIG_PATHS } from "@/domain/config/config.defaults";
import type { GitminalConfig } from "@/domain/config/config.types";

/** Latest status and console values captured by the probe. */
let latestStatus: ReturnType<typeof useStatus> | undefined;
let latestConsole: ReturnType<typeof useConsoleLog> | undefined;

/**
 * Builds a snapshot from warning and status overrides.
 *
 * @param overrides - Fields to override.
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
 * Builds a source that returns one snapshot per reload.
 *
 * @param loads - Snapshots to return in order.
 * @returns The source.
 */
function createSource(loads: readonly ConfigSnapshot[]): ConfigSource {
  let index = 0;

  return {
    paths: UNRESOLVED_CONFIG_PATHS,
    load: async (): Promise<ConfigSnapshot> => {
      const load = loads[index] ?? loads.at(-1);

      index += 1;

      if (load === undefined) {
        throw new Error("no load configured");
      }

      return load;
    },
  };
}

/**
 * Registers the configuration actions and captures the status and console providers.
 *
 * @returns A marker element.
 */
function ConfigActionsProbe(): ReactNode {
  useConfigActions();
  latestStatus = useStatus();
  latestConsole = useConsoleLog();

  return <text>config actions</text>;
}

/**
 * Renders the configuration action harness.
 *
 * @param options - Startup warnings, reload source, effective config, and static theme name.
 * @returns The rendered setup.
 */
async function renderActions(
  options: {
    readonly warnings?: readonly string[];
    readonly source?: ConfigSource;
    readonly config?: GitminalConfig;
    readonly themeName?: string;
  } = {},
): Promise<Awaited<ReturnType<typeof testRender>>> {
  latestStatus = undefined;
  latestConsole = undefined;

  const setup = await testRender(
    <ConfigProvider
      initialSnapshot={snapshot({
        warnings: options.warnings ?? [],
        config: options.config ?? DEFAULT_CONFIG,
      })}
      source={options.source}
    >
      <ThemeProvider themeName={options.themeName} capability="truecolor">
        <StatusProvider>
          <ConsoleProvider>
            <ConfigActionsProbe />
          </ConsoleProvider>
        </StatusProvider>
      </ThemeProvider>
    </ConfigProvider>,
    { width: 60, height: 12 },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

/**
 * Renders until the observed status matches a predicate or the deadline passes.
 *
 * @param setup - Renderer setup.
 * @param predicate - Condition over the latest transient status.
 */
async function waitForStatus(
  setup: Awaited<ReturnType<typeof testRender>>,
  predicate: (status: TransientStatus | null) => boolean,
): Promise<void> {
  const deadline = Date.now() + 2_000;

  while (!predicate(latestStatus?.status ?? null) && Date.now() < deadline) {
    await act(async () => {
      await setup.renderOnce();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

beforeEach(() => {
  resetActionRegistry();
});

describe("useConfigActions startup warnings", () => {
  it("shows the first warning in the status strip and one console notice", async () => {
    const setup = await renderActions({
      warnings: ['Unknown field "extra" in config.json; it was ignored.', "second warning"],
    });

    expect(latestStatus?.status).toEqual({
      kind: "warning",
      message: 'Unknown field "extra" in config.json; it was ignored.',
    });
    expect(latestConsole?.entries).toHaveLength(1);
    expect(latestConsole?.entries[0]?.status).toBe("info");
    expect(latestConsole?.entries[0]?.commandId).toBe("app.reloadConfig");
    expect(latestConsole?.entries[0]?.operationLabel).toBe("Configuration");
    expect(latestConsole?.entries[0]?.summary).toContain("second warning");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("does not report the same warning set twice", async () => {
    const setup = await renderActions({ warnings: ["one warning"] });

    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestConsole?.entries).toHaveLength(1);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("stays silent when the files produced no warnings", async () => {
    const setup = await renderActions();

    expect(latestStatus?.status).toBeNull();
    expect(latestConsole?.entries).toEqual([]);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("reports a theme warning with the distinguishable prefix", async () => {
    const setup = await renderActions({ themeName: "not-a-theme" });

    expect(latestStatus?.status?.kind).toBe("warning");
    expect(latestStatus?.status?.message).toMatch(/^Theme: Unknown theme/);
    expect(latestConsole?.entries).toHaveLength(1);
    expect(latestConsole?.entries[0]?.summary).toContain("Theme: Unknown theme");

    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestConsole?.entries).toHaveLength(1);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("reports configuration and theme warnings in one deduplicated notice", async () => {
    const setup = await renderActions({
      warnings: ["one configuration warning"],
      themeName: "not-a-theme",
    });
    const summary = latestConsole?.entries[0]?.summary ?? "";

    expect(latestConsole?.entries).toHaveLength(1);
    expect(summary).toContain("one configuration warning");
    expect(summary).toContain("Theme: Unknown theme");
    expect(latestStatus?.status?.message).toBe("one configuration warning");

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("app.reloadConfig", () => {
  it("is registered once as a global app action", async () => {
    const setup = await renderActions();

    expect(resolveActionHandler("app.reloadConfig", "global")).toBeDefined();

    await act(async () => {
      await setup.dispose();
    });

    expect(resolveActionHandler("app.reloadConfig", "global")).toBeUndefined();
  });

  it("shows a success status when the reload applies without warnings", async () => {
    const source = createSource([
      snapshot({ config: { ...DEFAULT_CONFIG, theme: "catppuccin-latte" } }),
    ]);
    const setup = await renderActions({ source });

    await act(async () => {
      resolveActionHandler("app.reloadConfig", "global")?.();
    });
    await waitForStatus(setup, (status) => status?.kind === "success");

    expect(latestStatus?.status).toEqual({ kind: "success", message: "Configuration reloaded" });
    expect(latestConsole?.entries).toEqual([]);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("warns and keeps the previous configuration when the reload is rejected", async () => {
    const warning = "Unsupported version 2 in config.json; the file was ignored.";
    const source = createSource([snapshot({ status: "rejected", warnings: [warning] })]);
    const setup = await renderActions({ source });

    await act(async () => {
      resolveActionHandler("app.reloadConfig", "global")?.();
    });
    await waitForStatus(setup, (status) => status?.message === warning);

    expect(latestStatus?.status).toEqual({ kind: "warning", message: warning });
    expect(latestConsole?.entries).toHaveLength(1);
    expect(latestConsole?.entries[0]?.summary).toBe(warning);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("reports a reload without warnings as a warning status", async () => {
    const source = createSource([snapshot({ status: "rejected" })]);
    const setup = await renderActions({ source });

    await act(async () => {
      resolveActionHandler("app.reloadConfig", "global")?.();
    });
    await waitForStatus(setup, (status) => status?.message === "Configuration reload failed");

    expect(latestStatus?.status).toEqual({
      kind: "warning",
      message: "Configuration reload failed",
    });

    await act(async () => {
      await setup.dispose();
    });
  });
});
