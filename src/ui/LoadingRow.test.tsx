import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { ShellTestProviders } from "@/test/shell.harness";
import { ICONS } from "@/theme/icons";
import { LoadingRow } from "@/ui/LoadingRow";

describe("LoadingRow", () => {
  it("renders the running marker, a spinner frame, and the label", async () => {
    const setup = await testRender(
      <ShellTestProviders>
        <box flexDirection="column" width={40} height={3}>
          <LoadingRow label="loading branches" />
        </box>
      </ShellTestProviders>,
      { width: 40, height: 3 },
    );

    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();

    expect(frame).toContain(ICONS.running);
    expect(frame).toContain("loading branches");
    expect(ICONS.spinnerFrames.some((spinnerFrame) => frame.includes(spinnerFrame))).toBe(true);

    await act(async () => {
      await setup.dispose();
    });
  });
});
