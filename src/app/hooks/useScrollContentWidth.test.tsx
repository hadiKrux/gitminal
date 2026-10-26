import { describe, expect, it } from "bun:test";
import type { ScrollBoxRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode, useRef } from "react";
import { useScrollContentWidth } from "@/app/hooks/useScrollContentWidth";
import { ShellTestProviders } from "@/test/shell.harness";

/** Viewport width captured by the probe. */
let measured = -1;

/** Width observed on every render of the frame probe. */
const renderedWidths: number[] = [];

/** Viewport object a controlled fake scrollbox exposes. */
const fakeViewport = { width: 39 };

/** Fake scrollbox whose viewport the controlled test can change. */
const fakeScrollbox = {
  width: 40,
  viewport: fakeViewport,
} as unknown as ScrollBoxRenderable;

/** Ref a controlled probe passes to the hook. */
const controlledRef: { current: ScrollBoxRenderable | null } = { current: null };

/** Reports the scrollbox size-change callback from the controlled probe. */
let triggerSizeChange: (() => void) | undefined;

/** Content lines that overflow the two-row probe viewport. */
const PROBE_LINES = Array.from({ length: 50 }, (_, index) => `line ${index} with content`);

/**
 * Renders an overflowing scrollbox that fills half the terminal.
 *
 * @returns The probe scrollbox.
 */
function Probe(): ReactNode {
  const ref = useRef<ScrollBoxRenderable | null>(null);
  const { width, onSizeChange } = useScrollContentWidth(ref);

  measured = width;

  return (
    <box flexDirection="column" width="50%">
      <scrollbox ref={ref} onSizeChange={onSizeChange} height={2}>
        {PROBE_LINES.map((line) => (
          <text key={line}>{line}</text>
        ))}
      </scrollbox>
    </box>
  );
}

/**
 * Renders an overflowing scrollbox that records each rendered width.
 *
 * @returns The probe scrollbox.
 */
function FrameProbe(): ReactNode {
  const ref = useRef<ScrollBoxRenderable | null>(null);
  const { width, onSizeChange } = useScrollContentWidth(ref);

  renderedWidths.push(width);

  return (
    <box flexDirection="column" width="50%">
      <scrollbox ref={ref} onSizeChange={onSizeChange} height={2}>
        {PROBE_LINES.map((line) => (
          <text key={line}>{line}</text>
        ))}
      </scrollbox>
    </box>
  );
}

/**
 * Renders a probe bound to a controlled fake scrollbox ref.
 *
 * @returns The controlled probe.
 */
function ControlledProbe(): ReactNode {
  const { width, onSizeChange } = useScrollContentWidth(controlledRef);

  measured = width;
  triggerSizeChange = onSizeChange;

  return <text>{`width ${width}`}</text>;
}

describe("useScrollContentWidth", () => {
  it("measures the viewport instead of the scrollbox box that includes the bar", async () => {
    const setup = await testRender(
      <ShellTestProviders>
        <Probe />
      </ShellTestProviders>,
      { width: 80, height: 8 },
    );

    await act(async () => {
      await setup.renderOnce();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(measured).toBe(39);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("re-reads the viewport after the panel resizes", async () => {
    const setup = await testRender(
      <ShellTestProviders>
        <Probe />
      </ShellTestProviders>,
      { width: 80, height: 8 },
    );

    await act(async () => {
      await setup.renderOnce();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(measured).toBe(39);

    await act(async () => {
      setup.resize(120, 8);
      await setup.renderOnce();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(measured).toBe(59);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("reports zero on the first frame and the viewport width after paint", async () => {
    renderedWidths.length = 0;

    const setup = await testRender(
      <ShellTestProviders>
        <FrameProbe />
      </ShellTestProviders>,
      { width: 80, height: 8 },
    );

    expect(renderedWidths[0]).toBe(0);

    await act(async () => {
      await setup.renderOnce();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(renderedWidths.at(-1)).toBe(39);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("re-reads a toggled scrollbar and keeps the last width after the ref unmounts", async () => {
    fakeViewport.width = 39;
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

    expect(measured).toBe(39);

    fakeViewport.width = 40;
    await act(async () => {
      triggerSizeChange?.();
      await setup.renderOnce();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(measured).toBe(40);

    fakeViewport.width = 39;
    await act(async () => {
      triggerSizeChange?.();
      await setup.renderOnce();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(measured).toBe(39);

    controlledRef.current = null;
    await act(async () => {
      triggerSizeChange?.();
      await setup.renderOnce();
    });

    expect(measured).toBe(39);

    await act(async () => {
      await setup.dispose();
    });
  });
});
