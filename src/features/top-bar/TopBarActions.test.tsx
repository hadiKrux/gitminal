import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
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

describe("TopBarActions", () => {
  it("renders Pull, then Push, then More as explicit text buttons", async () => {
    const frame = await captureActions();

    const pullIndex = frame.indexOf(`${ICONS.pull} Pull`);
    const pushIndex = frame.indexOf(`${ICONS.push} Push`);
    const moreIndex = frame.indexOf(`${ICONS.ellipsis} More`);

    expect(pullIndex).toBeGreaterThanOrEqual(0);
    expect(pushIndex).toBeGreaterThan(pullIndex);
    expect(moreIndex).toBeGreaterThan(pushIndex);
  });

  it("keeps disabled actions visible and renders their reason", async () => {
    const frame = await captureActions([
      control("info", "Branch"),
      { kind: "pull", label: "Pull", icon: ICONS.pull, available: false, reason: "detached HEAD" },
      { kind: "push", label: "Push", icon: ICONS.push, available: false, reason: "no remote" },
      control("more", "More", ICONS.ellipsis),
    ]);

    expect(frame).toContain(`${ICONS.pull} Pull detached HEAD`);
    expect(frame).toContain(`${ICONS.push} Push no remote`);
    expect(frame).toContain(`${ICONS.ellipsis} More`);
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

    expect(frame).toContain(`${ICONS.pull} Pull upstr${ICONS.ellipsis}`);
    expect(frame).toContain(`${ICONS.push} Push`);
    expect(frame).toContain(`${ICONS.ellipsis} More`);
  });

  it("moves the focus marker with the focused control kind", async () => {
    const pullFocused = await captureActions(ENABLED_CONTROLS, "pull");

    expect(pullFocused).toContain(`${ICONS.focus} ${ICONS.pull} Pull`);
    expect(pullFocused).not.toContain(`${ICONS.focus} ${ICONS.push} Push`);

    const moreFocused = await captureActions(ENABLED_CONTROLS, "more");

    expect(moreFocused).toContain(`${ICONS.focus} ${ICONS.ellipsis} More`);
    expect(moreFocused).not.toContain(`${ICONS.focus} ${ICONS.pull} Pull`);
  });
});
