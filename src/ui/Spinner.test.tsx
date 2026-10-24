import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { ShellTestProviders } from "@/test/shell.harness";
import { readSpinnerFrameIndex, Spinner } from "@/ui/Spinner";

/**
 * Renders a spinner with a short interval.
 *
 * @param intervalMs - Frame interval in milliseconds.
 * @returns The renderer setup.
 */
async function renderSpinner(intervalMs: number): Promise<Awaited<ReturnType<typeof testRender>>> {
  return testRender(
    <ShellTestProviders>
      <Spinner intervalMs={intervalMs} />
    </ShellTestProviders>,
    { width: 10, height: 3 },
  );
}

describe("readSpinnerFrameIndex", () => {
  it("maps progress across the frame list without going past the end", () => {
    expect(readSpinnerFrameIndex(0, 4)).toBe(0);
    expect(readSpinnerFrameIndex(0.24, 4)).toBe(0);
    expect(readSpinnerFrameIndex(0.26, 4)).toBe(1);
    expect(readSpinnerFrameIndex(0.5, 4)).toBe(2);
    expect(readSpinnerFrameIndex(0.75, 4)).toBe(3);
    expect(readSpinnerFrameIndex(1, 4)).toBe(3);
  });

  it("clamps out-of-range progress and empty frame lists", () => {
    expect(readSpinnerFrameIndex(-1, 4)).toBe(0);
    expect(readSpinnerFrameIndex(2, 4)).toBe(3);
    expect(readSpinnerFrameIndex(0.5, 0)).toBe(0);
  });
});

describe("Spinner", () => {
  it("cycles frames over time and unmounts cleanly", async () => {
    const setup = await renderSpinner(10);

    await act(async () => {
      await setup.renderOnce();
    });

    const firstFrame = setup.captureCharFrame();
    let changed = false;

    for (let attempt = 0; attempt < 30 && !changed; attempt += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        await setup.renderOnce();
      });

      changed = setup.captureCharFrame() !== firstFrame;
    }

    expect(changed).toBe(true);

    await act(async () => {
      await setup.dispose();
    });
  });
});
