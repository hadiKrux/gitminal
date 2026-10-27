import { describe, expect, it } from "bun:test";
import type { BoxRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { useBoxSize } from "@/app/hooks/useBoxSize";
import { ShellTestProviders } from "@/test/shell.harness";

/** Every row and column pair the controlled probe rendered. */
const renderedSizes: { readonly rows: number; readonly columns: number }[] = [];

/** Fake box whose size the controlled test can change. */
const fakeBox = { height: 5, width: 20 } as unknown as BoxRenderable;

/** Ref the controlled probe passes to the hook. */
const controlledRef: { current: BoxRenderable | null } = { current: null };

/** Reports the size-change callback from the controlled probe. */
let triggerSizeChange: (() => void) | undefined;

/**
 * Renders a probe bound to the controlled fake box ref.
 *
 * @returns The rendered size.
 */
function ControlledProbe(): ReactNode {
  const { rows, columns, onSizeChange } = useBoxSize(controlledRef);

  renderedSizes.push({ rows, columns });
  triggerSizeChange = onSizeChange;

  return <text>{`${rows}x${columns}`}</text>;
}

/**
 * Renders the controlled probe twice so a measured size settles.
 *
 * @param setup - Renderer setup.
 */
async function settle(setup: Awaited<ReturnType<typeof testRender>>): Promise<void> {
  await act(async () => {
    triggerSizeChange?.();
    await setup.renderOnce();
  });
  await act(async () => {
    await setup.renderOnce();
  });
}

describe("useBoxSize", () => {
  it("reports zero before layout and the box size once the ref is attached", async () => {
    renderedSizes.length = 0;
    fakeBox.height = 5;
    fakeBox.width = 20;
    controlledRef.current = null;

    const setup = await testRender(
      <ShellTestProviders>
        <ControlledProbe />
      </ShellTestProviders>,
      { width: 80, height: 8 },
    );

    expect(renderedSizes[0]).toEqual({ rows: 0, columns: 0 });

    controlledRef.current = fakeBox;
    await settle(setup);

    expect(renderedSizes.at(-1)).toEqual({ rows: 5, columns: 20 });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("ignores a non-finite axis and keeps the last measured size", async () => {
    renderedSizes.length = 0;
    fakeBox.height = 4;
    fakeBox.width = 30;
    controlledRef.current = fakeBox;

    const setup = await testRender(
      <ShellTestProviders>
        <ControlledProbe />
      </ShellTestProviders>,
      { width: 80, height: 8 },
    );

    await settle(setup);

    expect(renderedSizes.at(-1)).toEqual({ rows: 4, columns: 30 });

    fakeBox.height = Number.NaN;
    fakeBox.width = Number.NaN;
    await settle(setup);

    expect(renderedSizes.at(-1)).toEqual({ rows: 4, columns: 30 });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps an unchanged size stable and re-reads a changed one", async () => {
    renderedSizes.length = 0;
    fakeBox.height = 6;
    fakeBox.width = 40;
    controlledRef.current = fakeBox;

    const setup = await testRender(
      <ShellTestProviders>
        <ControlledProbe />
      </ShellTestProviders>,
      { width: 80, height: 8 },
    );

    await settle(setup);

    expect(renderedSizes.at(-1)).toEqual({ rows: 6, columns: 40 });

    await settle(setup);

    expect(renderedSizes.at(-1)).toEqual({ rows: 6, columns: 40 });

    fakeBox.height = 2;
    fakeBox.width = 10;
    await settle(setup);

    expect(renderedSizes.at(-1)).toEqual({ rows: 2, columns: 10 });

    await act(async () => {
      await setup.dispose();
    });
  });
});
