import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { ResponsiveGate } from "@/features/shell/ResponsiveGate";
import { ShellTestProviders } from "@/test/shell.harness";

/**
 * Renders the gate at one size and returns its captured frame.
 *
 * @param width - Terminal width.
 * @param height - Terminal height.
 * @returns The captured frame.
 */
async function captureGate(width: number, height: number): Promise<string> {
  const setup = await testRender(
    <ShellTestProviders>
      <ResponsiveGate
        renderShell={(layoutMode) => <text id="shell-mode">shell:{layoutMode}</text>}
      />
    </ShellTestProviders>,
    { width, height },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  const frame = setup.captureCharFrame();

  await act(async () => {
    await setup.dispose();
  });

  return frame;
}

describe("ResponsiveGate", () => {
  it("renders the shell in full and narrow layouts", async () => {
    expect(await captureGate(120, 40)).toContain("shell:full");
    expect(await captureGate(95, 30)).toContain("shell:narrow");
  });

  it("renders the collapsed sidebar layout below 90 columns", async () => {
    expect(await captureGate(85, 30)).toContain("shell:sidebar-collapsed");
  });

  it("renders the current, enforced minimum, and target sizes in the notice", async () => {
    const narrow = await captureGate(79, 30);
    const short = await captureGate(100, 23);

    expect(narrow).toContain("Terminal too small");
    expect(narrow).toContain("79x30");
    expect(narrow).toContain("Minimum size: 80x24");
    expect(narrow).toContain("Target size: 100x30");
    expect(narrow).not.toContain("shell:");

    expect(short).toContain("Terminal too small");
    expect(short).toContain("100x23");
    expect(short).toContain("Minimum size: 80x24");
    expect(short).toContain("Target size: 100x30");
  });

  it("keeps the shell at exactly the minimum size", async () => {
    expect(await captureGate(80, 24)).toContain("shell:sidebar-collapsed");
    expect(await captureGate(100, 30)).toContain("shell:full");
  });
});
