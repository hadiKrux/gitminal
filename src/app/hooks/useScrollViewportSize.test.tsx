import { describe, expect, it } from "bun:test";
import type { ScrollBoxRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { useScrollViewportSize } from "@/app/hooks/useScrollViewportSize";
import { ShellTestProviders } from "@/test/shell.harness";

/** Size captured by the controlled probe on every render. */
const renderedSizes: Array<{ readonly width: number; readonly height: number }> = [];

/** Viewport object the controlled fake scrollbox exposes. */
const fakeViewport = { width: 39, height: 5 };

/** Fake scrollbox whose viewport the controlled test can change. */
const fakeScrollbox = {
  width: 40,
  height: 6,
  viewport: fakeViewport,
} as unknown as ScrollBoxRenderable;

/** Ref the controlled probe passes to the hook. */
const controlledRef: { current: ScrollBoxRenderable | null } = { current: null };

/** Reports the scrollbox size-change callback from the controlled probe. */
let triggerSizeChange: (() => void) | undefined;

/** Renders a probe bound to the controlled fake scrollbox ref. */
function ControlledProbe(): ReactNode {
  const { width, height, onSizeChange } = useScrollViewportSize(controlledRef);

  renderedSizes.push({ width, height });
  triggerSizeChange = onSizeChange;

  return <text>{`${width}x${height}`}</text>;
}

describe("useScrollViewportSize", () => {
  it("reports zero before layout and the viewport size once the ref is attached", async () => {
    renderedSizes.length = 0;
    fakeViewport.width = 39;
    fakeViewport.height = 5;
    controlledRef.current = null;

    const setup = await testRender(
      <ShellTestProviders>
        <ControlledProbe />
      </ShellTestProviders>,
      { width: 80, height: 8 },
    );

    expect(renderedSizes[0]).toEqual({ width: 0, height: 0 });

    controlledRef.current = fakeScrollbox;
    await act(async () => {
      triggerSizeChange?.();
      await setup.renderOnce();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(renderedSizes.at(-1)).toEqual({ width: 39, height: 5 });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("re-reads a changed viewport height and keeps the last size after the ref unmounts", async () => {
    renderedSizes.length = 0;
    fakeViewport.width = 39;
    fakeViewport.height = 5;
    controlledRef.current = fakeScrollbox;

    const setup = await testRender(
      <ShellTestProviders>
        <ControlledProbe />
      </ShellTestProviders>,
      { width: 80, height: 8 },
    );

    await act(async () => {
      await setup.renderOnce();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(renderedSizes.at(-1)).toEqual({ width: 39, height: 5 });

    fakeViewport.height = 4;
    await act(async () => {
      triggerSizeChange?.();
      await setup.renderOnce();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(renderedSizes.at(-1)).toEqual({ width: 39, height: 4 });

    controlledRef.current = null;
    await act(async () => {
      triggerSizeChange?.();
      await setup.renderOnce();
    });

    expect(renderedSizes.at(-1)).toEqual({ width: 39, height: 4 });

    await act(async () => {
      await setup.dispose();
    });
  });
});
