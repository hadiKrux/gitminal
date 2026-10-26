import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode, useEffect, useState } from "react";
import { PanelScrollProvider, usePanelScroll } from "@/ui/PanelScrollContext";

let capturedScroll: ReturnType<typeof usePanelScroll> | undefined;
let capturedCalls: string[] = [];

/**
 * Reads the captured drawable width without relying on control-flow narrowing of the module value.
 *
 * @returns The captured drawable width, or undefined before the probe renders.
 */
function readDrawableWidth(): number | undefined {
  return capturedScroll?.drawableWidth;
}

/**
 * Records the context value a consumer reads and scrolls its child id once per change.
 *
 * @param props - Renderable id of the active row.
 * @returns A marker element.
 */
function ScrollProbe(props: { readonly childId: string }): ReactNode {
  const scroll = usePanelScroll();
  capturedScroll = scroll;

  useEffect(() => {
    scroll?.scrollChildIntoView(props.childId);
  }, [scroll, props.childId]);

  return <text>{props.childId}</text>;
}

/**
 * Provides a drawable width the test can resize after the first render.
 *
 * @param props - Initial drawable width and the setter the test drives.
 * @returns The provider stack.
 */
function ResizablePanel(props: {
  readonly initialWidth: number;
  readonly onReady: (setWidth: (width: number) => void) => void;
}): ReactNode {
  const [width, setWidth] = useState(props.initialWidth);

  props.onReady(setWidth);

  return (
    <PanelScrollProvider
      value={{
        drawableWidth: width,
        scrollChildIntoView: () => {},
      }}
    >
      <ScrollProbe childId="branch-row-main" />
    </PanelScrollProvider>
  );
}

describe("PanelScrollContext", () => {
  it("provides the scroll callback and drawable width to a panel body", async () => {
    capturedScroll = undefined;
    capturedCalls = [];
    const setup = await testRender(
      <PanelScrollProvider
        value={{
          drawableWidth: 28,
          scrollChildIntoView: (childId) => {
            capturedCalls.push(childId);
          },
        }}
      >
        <ScrollProbe childId="branch-row-main" />
      </PanelScrollProvider>,
      { width: 30, height: 3 },
    );

    await act(async () => {
      await setup.renderOnce();
    });

    expect(capturedScroll).not.toBeNull();
    expect(readDrawableWidth()).toBe(28);
    expect(capturedCalls).toEqual(["branch-row-main"]);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("updates the drawable width when the layout resizes", async () => {
    capturedScroll = undefined;
    let setWidth: (width: number) => void = () => {};
    const setup = await testRender(
      <ResizablePanel
        initialWidth={28}
        onReady={(next) => {
          setWidth = next;
        }}
      />,
      { width: 30, height: 3 },
    );

    await act(async () => {
      await setup.renderOnce();
    });

    expect(readDrawableWidth()).toBe(28);

    await act(async () => {
      setWidth(18);
      await setup.renderOnce();
    });

    expect(readDrawableWidth()).toBe(18);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("returns null outside a provider instead of throwing", async () => {
    capturedScroll = undefined;
    const setup = await testRender(<ScrollProbe childId="row-1" />, { width: 30, height: 3 });

    await act(async () => {
      await setup.renderOnce();
    });

    expect(capturedScroll).toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });
});
