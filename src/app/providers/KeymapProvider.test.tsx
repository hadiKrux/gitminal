import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { useKeymap } from "@/app/hooks/useKeymap";
import { ConfigProvider } from "@/app/providers/ConfigProvider";
import { KeymapProvider } from "@/app/providers/KeymapProvider";
import { DEFAULT_CONFIG } from "@/domain/config/config.defaults";
import type { GitminalConfig } from "@/domain/config/config.types";
import { ACTION_CATALOGUE } from "@/domain/keymap/keymap.defaults";
import { bindingKey } from "@/domain/keymap/keymap.parse";
import type { KeymapPlatform, ResolvedKeymap } from "@/domain/keymap/keymap.types";
import { readGuardError, renderGuard } from "@/test/react.guard";

/** Latest keymap rendered by the probe. */
let latest: ResolvedKeymap | undefined;

/**
 * Reads the latest keymap captured by the probe.
 *
 * @returns The rendered keymap.
 */
function readLatest(): ResolvedKeymap | undefined {
  return latest;
}

/**
 * Renders the keymap context value and captures it for assertions.
 *
 * @returns A marker element.
 */
function KeymapProbe(): ReactNode {
  latest = useKeymap();

  return <text>keymap</text>;
}

/**
 * Calls `useKeymap` without a provider so the boundary can catch its guard error.
 *
 * @returns A marker element.
 */
function KeymapGuardProbe(): ReactNode {
  useKeymap();

  return <text>keymap guard</text>;
}

/**
 * Renders the keymap providers with an optional configuration and platform.
 *
 * @param config - Effective configuration.
 * @param platform - Platform used to expand `mod`.
 * @returns The rendered setup.
 */
async function renderKeymap(
  config: GitminalConfig = DEFAULT_CONFIG,
  platform?: KeymapPlatform,
): Promise<Awaited<ReturnType<typeof testRender>>> {
  latest = undefined;

  return testRender(
    <ConfigProvider initialConfig={config}>
      <KeymapProvider platform={platform}>
        <KeymapProbe />
      </KeymapProvider>
    </ConfigProvider>,
    { width: 40, height: 10 },
  );
}

describe("KeymapProvider", () => {
  it("resolves the full default catalogue", async () => {
    const setup = await renderKeymap(DEFAULT_CONFIG, "linux");

    await act(async () => {
      await setup.renderOnce();
    });

    expect(readLatest()?.bindings.size).toBe(ACTION_CATALOGUE.length);
    expect(readLatest()?.contexts.get("global")?.get("q")).toBe("app.quit");
    expect(readLatest()?.contexts.get("global")?.get("ctrl+c")).toBe("app.quit");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("applies keybinding overrides from the effective configuration", async () => {
    const config: GitminalConfig = {
      ...DEFAULT_CONFIG,
      keybindings: { "app.refresh": ["x"] },
    };
    const setup = await renderKeymap(config, "linux");

    await act(async () => {
      await setup.renderOnce();
    });

    expect(readLatest()?.bindings.get("app.refresh")?.map(bindingKey)).toEqual(["x"]);
    expect(readLatest()?.contexts.get("global")?.get("x")).toBe("app.refresh");
    expect(readLatest()?.contexts.get("global")?.get("r")).toBeUndefined();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("surfaces resolution warnings without blocking the provider", async () => {
    const config: GitminalConfig = {
      ...DEFAULT_CONFIG,
      keybindings: { "graph.selectCommit": ["x"] },
    };
    const setup = await renderKeymap(config, "linux");

    await act(async () => {
      await setup.renderOnce();
    });

    expect(readLatest()?.warnings.some((warning) => warning.includes("graph.selectCommit"))).toBe(
      true,
    );
    expect(readLatest()?.bindings.size).toBe(ACTION_CATALOGUE.length);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("passes the platform through to mod expansion", async () => {
    const mac = await renderKeymap(DEFAULT_CONFIG, "macos");

    await act(async () => {
      await mac.renderOnce();
    });

    expect(readLatest()?.platform).toBe("macos");
    expect(readLatest()?.contexts.get("global")?.get("meta+p")).toBe("app.palette");

    await act(async () => {
      await mac.dispose();
    });

    const linux = await renderKeymap(DEFAULT_CONFIG, "linux");

    await act(async () => {
      await linux.renderOnce();
    });

    expect(readLatest()?.platform).toBe("linux");
    expect(readLatest()?.contexts.get("global")?.get("meta+p")).toBeUndefined();

    await act(async () => {
      await linux.dispose();
    });
  });

  it("throws when useKeymap runs outside a KeymapProvider", async () => {
    const setup = await renderGuard(<KeymapGuardProbe />);

    await act(async () => {
      await setup.renderOnce();
    });

    expect(readGuardError()).toBe("useKeymap must be used within a KeymapProvider.");

    await act(async () => {
      await setup.dispose();
    });
  });
});
