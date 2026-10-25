import { describe, expect, it } from "bun:test";
import { type CapturedFrame, type CapturedSpan, RGBA } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { DEFAULT_THEME_NAME, THEME_FLAVORS } from "@/domain/theme/theme.catppuccin";
import { TopBarActions } from "@/features/top-bar/TopBarActions";
import type { TopBarControl, TopBarControlKind } from "@/features/top-bar/useTopBar.types";
import { ShellTestProviders } from "@/test/shell.harness";
import { ICONS } from "@/theme/icons";

/**
 * Builds an available control.
 *
 * @param kind - Control kind.
 * @param label - Visible label.
 * @param icon - Optional leading marker.
 * @returns The control.
 */
function control(kind: TopBarControl["kind"], label: string, icon?: string): TopBarControl {
  return { kind, label, icon, available: true, reason: null };
}

/** Controls for a repository where every remote action is available. */
const ENABLED_CONTROLS: readonly TopBarControl[] = [
  control("info", "Branch"),
  control("pull", "Pull", ICONS.pull),
  control("push", "Push", ICONS.push),
  control("more", "More", ICONS.ellipsis),
];

/**
 * Renders the action strip.
 *
 * @param controls - Controls in order.
 * @param focusedKind - Focused control kind.
 * @param reasonWidth - Reason budget.
 * @returns The renderer setup.
 */
async function renderActions(
  controls: readonly TopBarControl[] = ENABLED_CONTROLS,
  focusedKind: TopBarControlKind = "info",
  reasonWidth: number = 24,
): Promise<Awaited<ReturnType<typeof testRender>>> {
  return testRender(
    <ShellTestProviders>
      <box flexDirection="row" width={120} height={1}>
        <TopBarActions
          controls={controls}
          focusedKind={focusedKind}
          reasonWidth={reasonWidth}
          onActivate={() => {}}
        />
      </box>
    </ShellTestProviders>,
    { width: 120, height: 3 },
  );
}

/**
 * Renders the strip and returns its frame.
 *
 * @param controls - Controls in order.
 * @param focusedKind - Focused control kind.
 * @param reasonWidth - Reason budget.
 * @returns The captured frame.
 */
async function captureActions(
  controls: readonly TopBarControl[] = ENABLED_CONTROLS,
  focusedKind: TopBarControlKind = "info",
  reasonWidth: number = 24,
): Promise<string> {
  const setup = await renderActions(controls, focusedKind, reasonWidth);

  await act(async () => {
    await setup.renderOnce();
  });

  const frame = setup.captureCharFrame();

  await act(async () => {
    await setup.dispose();
  });

  return frame;
}

/**
 * Renders the action strip and captures its colored spans.
 *
 * @param focusedKind - Focused control kind.
 * @returns The captured frame with its colored spans.
 */
async function captureActionSpans(focusedKind: TopBarControlKind): Promise<CapturedFrame> {
  const setup = await renderActions(ENABLED_CONTROLS, focusedKind);

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

describe("TopBarActions", () => {
  it("renders Pull, then Push, then More as icon-only buttons", async () => {
    const frame = await captureActions();

    const pullIndex = frame.indexOf(ICONS.pull);
    const pushIndex = frame.indexOf(ICONS.push);
    const moreIndex = frame.indexOf(ICONS.ellipsis);

    expect(pullIndex).toBeGreaterThanOrEqual(0);
    expect(pushIndex).toBeGreaterThan(pullIndex);
    expect(moreIndex).toBeGreaterThan(pushIndex);
    expect(frame).not.toContain("Pull");
    expect(frame).not.toContain("Push");
    expect(frame).not.toContain("More");
  });

  it("keeps disabled actions visible and renders their reason", async () => {
    const frame = await captureActions([
      control("info", "Branch"),
      { kind: "pull", label: "Pull", icon: ICONS.pull, available: false, reason: "detached HEAD" },
      { kind: "push", label: "Push", icon: ICONS.push, available: false, reason: "no remote" },
      control("more", "More", ICONS.ellipsis),
    ]);

    expect(frame).toContain(`${ICONS.pull} detached HEAD`);
    expect(frame).toContain(`${ICONS.push} no remote`);
    expect(frame).toContain(ICONS.ellipsis);
  });

  it("truncates a long reason before dropping an action", async () => {
    const frame = await captureActions(
      [
        control("info", "Branch"),
        {
          kind: "pull",
          label: "Pull",
          icon: ICONS.pull,
          available: false,
          reason: "upstream gone; push to recreate it",
        },
        control("push", "Push", ICONS.push),
        control("more", "More", ICONS.ellipsis),
      ],
      "pull",
      8,
    );

    expect(frame).toContain(`${ICONS.pull} upstr${ICONS.ellipsis}`);
    expect(frame).toContain(ICONS.push);
    expect(frame).toContain(ICONS.ellipsis);
  });

  it("moves the focused background with the focused control kind and never adds a marker", async () => {
    const tokens = THEME_FLAVORS[DEFAULT_THEME_NAME].tokens;
    const pullFocused = await captureActionSpans("pull");

    const pullSpan = findSpanContaining(pullFocused, ICONS.pull);
    const pushSpan = findSpanContaining(pullFocused, ICONS.push);

    expect(pullSpan.bg.equals(RGBA.fromHex(tokens.selection))).toBe(true);
    expect(pushSpan.bg.equals(RGBA.fromHex(tokens.border))).toBe(true);
    expect(readFrameText(pullFocused)).not.toContain(ICONS.focus);

    const moreFocused = await captureActionSpans("more");
    const moreSpan = findSpanContaining(moreFocused, ICONS.ellipsis);
    const unfocusedPullSpan = findSpanContaining(moreFocused, ICONS.pull);

    expect(moreSpan.bg.equals(RGBA.fromHex(tokens.selection))).toBe(true);
    expect(unfocusedPullSpan.bg.equals(RGBA.fromHex(tokens.border))).toBe(true);
  });
});
