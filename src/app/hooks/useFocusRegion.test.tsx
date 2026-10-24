import { beforeEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { useFocusRegion } from "@/app/hooks/useFocusRegion";
import { ConfigProvider } from "@/app/providers/ConfigProvider";
import { FocusProvider } from "@/app/providers/FocusProvider";
import { ThemeProvider } from "@/app/providers/ThemeProvider";
import { DEFAULT_THEME_NAME } from "@/domain/theme/theme.catppuccin";
import { resolveTheme } from "@/domain/theme/theme.resolve";

/** Latest handle captured by the probe. */
let latest: ReturnType<typeof useFocusRegion> | undefined;

/**
 * Binds to the branches region and renders its frame.
 *
 * @returns The region frame.
 */
function RegionProbe(): ReactNode {
  const region = useFocusRegion("branches");
  latest = region;

  return (
    <box {...region.regionProps} width={30} height={4}>
      <input id="field" width={10} />
    </box>
  );
}

/**
 * Renders the region probe plus an outside focus target.
 *
 * @returns The harness layout.
 */
function Harness(): ReactNode {
  return (
    <box flexDirection="column" width={40} height={10}>
      <RegionProbe />
      <box id="outside" focusable width={10} height={1}>
        <text>outside</text>
      </box>
    </box>
  );
}

/**
 * Focuses a renderable by id.
 *
 * @param setup - Renderer setup.
 * @param id - Renderable id.
 */
async function focusById(setup: Awaited<ReturnType<typeof testRender>>, id: string): Promise<void> {
  await act(async () => {
    setup.renderer.root.findDescendantById(id)?.focus();
  });
  await act(async () => {
    await setup.renderOnce();
  });
}

beforeEach(() => {
  latest = undefined;
});

describe("useFocusRegion", () => {
  it("exposes the stable frame identity and focus colors", async () => {
    const setup = await testRender(
      <ConfigProvider>
        <ThemeProvider>
          <FocusProvider>
            <Harness />
          </FocusProvider>
        </ThemeProvider>
      </ConfigProvider>,
      { width: 40, height: 10 },
    );

    await act(async () => {
      await setup.renderOnce();
    });

    const tokens = resolveTheme(DEFAULT_THEME_NAME).tokens;

    expect(latest?.regionProps.id).toBe("region-branches");
    expect(latest?.regionProps.focusable).toBe(true);
    expect(latest?.regionProps.focusedBorderColor).toBe(tokens.focus);
    expect(latest?.regionProps.borderColor).toBe(tokens.border);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("focuses the region frame through the returned action", async () => {
    const setup = await testRender(
      <ConfigProvider>
        <ThemeProvider>
          <FocusProvider>
            <Harness />
          </FocusProvider>
        </ThemeProvider>
      </ConfigProvider>,
      { width: 40, height: 10 },
    );

    await act(async () => {
      await setup.renderOnce();
    });

    expect(latest?.focused).toBe(false);

    await act(async () => {
      latest?.focus();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latest?.focused).toBe(true);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region-branches");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("stays focused while a text input inside the region owns focus", async () => {
    const setup = await testRender(
      <ConfigProvider>
        <ThemeProvider>
          <FocusProvider>
            <Harness />
          </FocusProvider>
        </ThemeProvider>
      </ConfigProvider>,
      { width: 40, height: 10 },
    );

    await act(async () => {
      await setup.renderOnce();
    });
    await focusById(setup, "field");

    expect(latest?.focused).toBe(true);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("is not focused when focus is outside every region", async () => {
    const setup = await testRender(
      <ConfigProvider>
        <ThemeProvider>
          <FocusProvider>
            <Harness />
          </FocusProvider>
        </ThemeProvider>
      </ConfigProvider>,
      { width: 40, height: 10 },
    );

    await act(async () => {
      await setup.renderOnce();
    });
    await focusById(setup, "region-branches");
    await focusById(setup, "outside");

    expect(latest?.focused).toBe(false);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("reads and writes the region cursor", async () => {
    const setup = await testRender(
      <ConfigProvider>
        <ThemeProvider>
          <FocusProvider>
            <Harness />
          </FocusProvider>
        </ThemeProvider>
      </ConfigProvider>,
      { width: 40, height: 10 },
    );

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      latest?.setCursor("main");
    });

    expect(latest?.getCursor()).toBe("main");

    await act(async () => {
      latest?.setCursor(null);
    });

    expect(latest?.getCursor()).toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });
});
