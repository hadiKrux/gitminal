import { describe, expect, it } from "bun:test";
import type { BoxRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { useBoxRows } from "@/app/hooks/useBoxRows";
import { ShellTestProviders } from "@/test/shell.harness";

/** Every row value the controlled probe rendered. */
const renderedRows: number[] = [];

/** Fake box whose height the controlled test can change. */
const fakeBox = { height: 5 } as unknown as BoxRenderable;

/** Ref the controlled probe passes to the hook. */
const controlledRef: { current: BoxRenderable | null } = { current: null };

/** Reports the size-change callback from the controlled probe. */
let triggerSizeChange: (() => void) | undefined;

/**
 * Renders a probe bound to the controlled fake box ref.
 *
 * @returns The rendered row count.
 */
function ControlledProbe(): ReactNode {
  const { rows, onSizeChange } = useBoxRows(controlledRef);

  renderedRows.push(rows);
  triggerSizeChange = onSizeChange;

  return <text>{`${rows}`}</text>;
}

describe("useBoxRows", () => {
  it("reports zero before layout and the box rows once the ref is attached", async () => {
    renderedRows.length = 0;
    fakeBox.height = 5;
    controlledRef.current = null;

    const setup = await testRender(
      <ShellTestProviders>
        <ControlledProbe />
      </ShellTestProviders>,
      { width: 80, height: 8 },
    );

    expect(renderedRows[0]).toBe(0);

    controlledRef.current = fakeBox;
    await act(async () => {
      triggerSizeChange?.();
      await setup.renderOnce();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(renderedRows.at(-1)).toBe(5);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("ignores a non-finite height and keeps the last measured rows", async () => {
    renderedRows.length = 0;
    fakeBox.height = 4;
    controlledRef.current = fakeBox;

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

    expect(renderedRows.at(-1)).toBe(4);

    fakeBox.height = Number.NaN;
    await act(async () => {
      triggerSizeChange?.();
      await setup.renderOnce();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(renderedRows.at(-1)).toBe(4);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps an unchanged size stable and re-reads a changed one", async () => {
    renderedRows.length = 0;
    fakeBox.height = 6;
    controlledRef.current = fakeBox;

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

    expect(renderedRows.at(-1)).toBe(6);

    await act(async () => {
      triggerSizeChange?.();
      await setup.renderOnce();
    });

    expect(renderedRows.at(-1)).toBe(6);

    fakeBox.height = 2;
    await act(async () => {
      triggerSizeChange?.();
      await setup.renderOnce();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(renderedRows.at(-1)).toBe(2);

    await act(async () => {
      await setup.dispose();
    });
  });
});
