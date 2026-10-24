import { describe, expect, it, spyOn } from "bun:test";
import { type FrameBufferRenderable, RGBA } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode, useState } from "react";
import { ShellTestProviders } from "@/test/shell.harness";
import { useTokens } from "@/theme/useTokens";
import { calculateProgressFill, clampProgressBarWidth, ProgressBar } from "@/ui/ProgressBar";

/** Renderable id used to find the bar in a test frame. */
const BAR_ID = "progress-bar-under-test";

/** Updates the mounted bar's props. */
let setBarProps: (percent: number, width: number) => void = () => {};

/** Theme tokens captured from the mounted provider. */
let capturedTokens: ReturnType<typeof useTokens> | null = null;

/**
 * Captures the active theme tokens for the drawing assertions.
 *
 * @returns Nothing.
 */
function TokenProbe(): null {
  capturedTokens = useTokens();

  return null;
}

/**
 * Mounts a bar whose percent and width a test can change.
 *
 * @returns The bar inside the theme provider.
 */
function BarHarness(): ReactNode {
  const [props, setProps] = useState({ percent: 0, width: 10 });

  setBarProps = (percent, width): void => {
    setProps({ percent, width });
  };

  return (
    <ShellTestProviders>
      <TokenProbe />
      <box flexDirection="column" width={40} height={4}>
        <ProgressBar id={BAR_ID} percent={props.percent} width={props.width} />
      </box>
    </ShellTestProviders>
  );
}

/**
 * Waits for the bar's throttled redraw.
 *
 * @param setup - Renderer setup.
 */
async function waitForDraw(setup: Awaited<ReturnType<typeof testRender>>): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 130));
    await setup.renderOnce();
  });
}

/**
 * Reads the mounted frame-buffer renderable.
 *
 * @param setup - Renderer setup.
 * @returns The renderable.
 */
function readBar(setup: Awaited<ReturnType<typeof testRender>>): FrameBufferRenderable {
  const bar = setup.renderer.root.findDescendantById(BAR_ID) as FrameBufferRenderable | undefined;

  if (bar === undefined) {
    throw new Error("progress bar renderable missing");
  }

  return bar;
}

describe("calculateProgressFill", () => {
  it("clamps progress to the 0 to 100 range", () => {
    expect(calculateProgressFill(-30, 10)).toBe(0);
    expect(calculateProgressFill(0, 10)).toBe(0);
    expect(calculateProgressFill(100, 10)).toBe(10);
    expect(calculateProgressFill(180, 10)).toBe(10);
  });

  it("rounds the filled cells to the nearest cell", () => {
    expect(calculateProgressFill(50, 10)).toBe(5);
    expect(calculateProgressFill(12, 8)).toBe(1);
    expect(calculateProgressFill(20, 8)).toBe(2);
    expect(calculateProgressFill(33, 8)).toBe(3);
    expect(calculateProgressFill(99, 8)).toBe(8);
  });

  it("clamps the width into the 8 to 24 cell range", () => {
    expect(calculateProgressFill(100, 2)).toBe(8);
    expect(calculateProgressFill(100, 100)).toBe(24);
    expect(calculateProgressFill(50, 24)).toBe(12);
  });

  it("never fills more cells than the bar has", () => {
    for (let percent = 0; percent <= 100; percent += 5) {
      const filled = calculateProgressFill(percent, 9);

      expect(filled).toBeGreaterThanOrEqual(0);
      expect(filled).toBeLessThanOrEqual(9);
    }
  });

  it("treats a non-finite percentage as empty", () => {
    expect(calculateProgressFill(Number.NaN, 12)).toBe(0);
    expect(calculateProgressFill(Number.POSITIVE_INFINITY, 12)).toBe(0);
  });
});

describe("clampProgressBarWidth", () => {
  it("clamps to whole cells between 8 and 24", () => {
    expect(clampProgressBarWidth(0)).toBe(8);
    expect(clampProgressBarWidth(8)).toBe(8);
    expect(clampProgressBarWidth(12.6)).toBe(13);
    expect(clampProgressBarWidth(24)).toBe(24);
    expect(clampProgressBarWidth(40)).toBe(24);
    expect(clampProgressBarWidth(Number.NaN)).toBe(8);
  });
});

describe("ProgressBar drawing", () => {
  it("fills the track and the rounded portion and requests a render", async () => {
    const setup = await testRender(<BarHarness />, { width: 40, height: 8 });
    const bar = readBar(setup);

    await waitForDraw(setup);

    const fillRect = spyOn(bar.frameBuffer, "fillRect");
    const requestRender = spyOn(bar, "requestRender");

    await act(async () => {
      setBarProps(50, 10);
    });

    await waitForDraw(setup);

    const calls = fillRect.mock.calls.map((call) => call.slice(0, 4));
    const tokens = capturedTokens;

    if (tokens === null) {
      throw new Error("theme tokens were not captured");
    }

    const trackCall = fillRect.mock.calls.find(
      (call) => call[0] === 0 && call[1] === 0 && call[2] === 10 && call[3] === 1,
    );
    const fillCall = fillRect.mock.calls.find(
      (call) => call[0] === 0 && call[1] === 0 && call[2] === 5 && call[3] === 1,
    );

    expect(calls).toContainEqual([0, 0, 10, 1]);
    expect(calls).toContainEqual([0, 0, 5, 1]);
    expect(trackCall).toBeDefined();
    expect(fillCall).toBeDefined();
    expect(trackCall?.[4]?.equals(RGBA.fromHex(tokens.surface))).toBeTrue();
    expect(fillCall?.[4]?.equals(RGBA.fromHex(tokens.accent))).toBeTrue();
    expect(requestRender).toHaveBeenCalled();

    fillRect.mockRestore();
    requestRender.mockRestore();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("redraws with the new track width when the width changes", async () => {
    const setup = await testRender(<BarHarness />, { width: 40, height: 8 });
    const bar = readBar(setup);

    await waitForDraw(setup);

    const fillRect = spyOn(bar.frameBuffer, "fillRect");
    const requestRender = spyOn(bar, "requestRender");

    await act(async () => {
      setBarProps(25, 16);
    });

    await waitForDraw(setup);

    const calls = fillRect.mock.calls.map((call) => call.slice(0, 4));

    expect(calls).toContainEqual([0, 0, 16, 1]);
    expect(calls).toContainEqual([0, 0, 4, 1]);
    expect(requestRender).toHaveBeenCalled();

    fillRect.mockRestore();
    requestRender.mockRestore();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("redraws after a height-only resize even when the width is unchanged", async () => {
    const setup = await testRender(<BarHarness />, { width: 40, height: 8 });
    const bar = readBar(setup);

    await waitForDraw(setup);

    const requestRender = spyOn(bar, "requestRender");

    await act(async () => {
      setup.resize(40, 12);
    });

    await waitForDraw(setup);

    expect(requestRender).toHaveBeenCalled();

    requestRender.mockRestore();

    await act(async () => {
      await setup.dispose();
    });
  });
});
