import { describe, expect, it } from "bun:test";
import { type CapturedFrame, type CapturedSpan, RGBA, TextAttributes } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { ShellTestProviders } from "@/test/shell.harness";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import { Button } from "@/ui/Button";
import type { ButtonProps } from "@/ui/Button.types";

/** Theme tokens captured from the mounted provider. */
let capturedTokens: ReturnType<typeof useTokens> | undefined;

/**
 * Captures the active theme tokens for the color assertions.
 *
 * @returns Nothing.
 */
function TokenProbe(): null {
  capturedTokens = useTokens();

  return null;
}

/**
 * Reads the tokens captured during the last render.
 *
 * @returns The active theme tokens.
 * @throws When the probe has not rendered.
 */
function readTokens(): ReturnType<typeof useTokens> {
  if (capturedTokens === undefined) {
    throw new Error("theme tokens were not captured");
  }

  return capturedTokens;
}

/**
 * Renders one button and captures its colored spans.
 *
 * @param props - Button props.
 * @returns The captured frame with its colored spans.
 */
async function captureButton(props: ButtonProps): Promise<CapturedFrame> {
  const setup = await testRender(
    <ShellTestProviders>
      <TokenProbe />
      <box flexDirection="row" width={40} height={1}>
        <Button {...props} />
      </box>
    </ShellTestProviders>,
    { width: 40, height: 3 },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  const frame = setup.captureSpans();

  await act(async () => {
    await setup.dispose();
  });

  return frame;
}

/**
 * Finds the first captured span whose text contains the given text.
 *
 * @param frame - Captured frame with colored spans.
 * @param text - Text the span must contain.
 * @returns The matching span.
 * @throws When no span matches.
 */
function findSpanContaining(frame: CapturedFrame, text: string): CapturedSpan {
  for (const line of frame.lines) {
    for (const span of line.spans) {
      if (span.text.includes(text)) {
        return span;
      }
    }
  }

  throw new Error(`No captured span contains ${text}`);
}

/**
 * Reads the visible text of a captured frame.
 *
 * @param frame - Captured frame with colored spans.
 * @returns The text of every span, line by line.
 */
function readFrameText(frame: CapturedFrame): string {
  return frame.lines.map((line) => line.spans.map((span) => span.text).join("")).join("\n");
}

describe("Button", () => {
  it("renders an unfocused button as a filled control with text-colored label", async () => {
    const frame = await captureButton({ label: "Pull", icon: ICONS.pull });
    const tokens = readTokens();
    const label = findSpanContaining(frame, `${ICONS.pull} Pull`);

    expect(label.bg.equals(RGBA.fromHex(tokens.border))).toBe(true);
    expect(label.fg.equals(RGBA.fromHex(tokens.text))).toBe(true);
  });

  it("renders only the icon when iconOnly is set", async () => {
    const frame = await captureButton({ label: "Pull", icon: ICONS.pull, iconOnly: true });

    expect(readFrameText(frame)).toContain(ICONS.pull);
    expect(readFrameText(frame)).not.toContain("Pull");
  });

  it("marks focus with the selection background and bold text without a marker", async () => {
    const frame = await captureButton({ label: "Commit", focused: true });
    const tokens = readTokens();
    const label = findSpanContaining(frame, "Commit");

    expect(label.bg.equals(RGBA.fromHex(tokens.selection))).toBe(true);
    expect(label.attributes & TextAttributes.BOLD).toBe(TextAttributes.BOLD);
    expect(readFrameText(frame)).not.toContain(ICONS.focus);
  });

  it("dims a disabled button and appends its reason", async () => {
    const frame = await captureButton({
      label: "Commit",
      disabled: true,
      reason: "message required",
    });
    const tokens = readTokens();
    const label = findSpanContaining(frame, "Commit");

    expect(label.bg.equals(RGBA.fromHex(tokens.border))).toBe(true);
    expect(label.fg.equals(RGBA.fromHex(tokens.dim))).toBe(true);
    expect(readFrameText(frame)).toContain("Commit message required");
  });
});
