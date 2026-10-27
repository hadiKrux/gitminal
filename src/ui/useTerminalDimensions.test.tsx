import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, useState } from "react";
import { useTerminalDimensions } from "./useTerminalDimensions";
import type { TerminalDimensions } from "./useTerminalDimensions.types";

const snapshots = new Map<string, TerminalDimensions>();
const rowIds = Array.from({ length: 50 }, (_, index) => `row-${index}`);
let setCount: (count: number) => void = () => {};

function Row({ id }: { id: string }) {
  const dimensions = useTerminalDimensions();
  snapshots.set(id, dimensions);
  return <text>{`${id}: ${dimensions.width}x${dimensions.height}`}</text>;
}

function Harness() {
  const [count, updateCount] = useState(0);
  setCount = updateCount;
  return (
    <box>
      {rowIds.slice(0, count).map((id) => (
        <Row key={id} id={id} />
      ))}
    </box>
  );
}

describe("useTerminalDimensions", () => {
  it("shares one listener across rows, updates every consumer, and cleans up on unmount", async () => {
    snapshots.clear();

    const setup = await testRender(<Harness />, { width: 80, height: 24 });
    const baseline = setup.renderer.listenerCount("resize");

    try {
      await act(async () => {
        setCount(50);
        await setup.renderOnce();
      });
      expect(setup.renderer.listenerCount("resize")).toBe(baseline + 1);
      expect(snapshots.size).toBe(50);
      expect(snapshots.get("row-0")).toEqual({ width: 80, height: 24 });
      expect(new Set(snapshots.values()).size).toBe(1);

      await act(async () => {
        setup.resize(100, 30);
        await setup.renderOnce();
      });
      expect(
        [...snapshots.values()].every((size) => size.width === 100 && size.height === 30),
      ).toBe(true);

      await act(async () => {
        setup.resize(100, 40);
        await setup.renderOnce();
      });
      expect([...snapshots.values()].every((size) => size.height === 40)).toBe(true);

      await act(async () => {
        setCount(1);
        await setup.renderOnce();
      });
      expect(setup.renderer.listenerCount("resize")).toBe(baseline + 1);

      await act(async () => {
        setCount(0);
        await setup.renderOnce();
      });
      expect(setup.renderer.listenerCount("resize")).toBe(baseline);

      await act(async () => {
        setup.resize(90, 20);
        await setup.renderOnce();
        setCount(20);
        await setup.renderOnce();
      });
      expect(snapshots.get("row-0")).toEqual({ width: 90, height: 20 });
      expect(setup.renderer.listenerCount("resize")).toBe(baseline + 1);
    } finally {
      await act(async () => {
        await setup.dispose();
      });
    }

    expect(setup.renderer.listenerCount("resize")).toBe(0);
  });

  it("isolates dimensions and subscriptions between renderers", async () => {
    snapshots.clear();

    const first = await testRender(<Row id="first" />, { width: 80, height: 24 });
    const second = await testRender(<Row id="second" />, { width: 120, height: 40 });

    try {
      expect(snapshots.get("first")).toEqual({ width: 80, height: 24 });
      expect(snapshots.get("second")).toEqual({ width: 120, height: 40 });

      await act(async () => {
        first.resize(90, 30);
        await first.renderOnce();
      });
      expect(snapshots.get("first")).toEqual({ width: 90, height: 30 });
      expect(snapshots.get("second")).toEqual({ width: 120, height: 40 });
    } finally {
      await act(async () => {
        await first.dispose();
        // Disposing one test renderer clears this global flag even while another is mounted.
        Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
        await second.dispose();
      });
    }
  });
});
