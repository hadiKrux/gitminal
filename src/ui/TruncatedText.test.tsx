import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { ShellTestProviders } from "@/test/shell.harness";
import { ICONS } from "@/theme/icons";
import { TruncatedText } from "@/ui/TruncatedText";

async function renderText(text: string, maxWidth: number): Promise<string> {
  const setup = await testRender(
    <ShellTestProviders>
      <box flexDirection="column" width={40} height={2}>
        <TruncatedText text={text} maxWidth={maxWidth} />
      </box>
    </ShellTestProviders>,
    { width: 40, height: 2 },
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

describe("TruncatedText", () => {
  it("keeps text that fits the budget unchanged", async () => {
    const frame = await renderText("main", 10);

    expect(frame.split("\n")[0]?.trimEnd()).toBe("main");
  });

  it("truncates overlong text with the ICONS ellipsis inside the budget", async () => {
    const frame = await renderText("feature/very-long-branch-name", 12);
    const line = frame.split("\n")[0]?.trimEnd() ?? "";

    expect(line.length).toBeLessThanOrEqual(12);
    expect(line.endsWith(ICONS.ellipsis)).toBe(true);
  });
});
