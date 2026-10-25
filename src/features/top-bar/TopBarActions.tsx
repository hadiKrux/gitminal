import type { ReactNode } from "react";
import type { TopBarControl, TopBarControlKind } from "@/features/top-bar/useTopBar.types";
import { truncateText } from "@/lib/text";
import { ICONS } from "@/theme/icons";
import type { ButtonProps } from "@/ui/Button.types";
import { ButtonRow } from "@/ui/ButtonRow";

/**
 * Renders the Pull, Push, and More icon-only action strip.
 *
 * The controls arrive in `nav.left`/`nav.right` order, and the idle info control is skipped because
 * it is not an action. Each action renders only its icon; its label stays in the control model for
 * availability, tests, the footer, help, and the palette. Padded filled buttons with a focused
 * background replace the text labels. Disabled actions stay visible and render their exact
 * availability reason, shortened only when the width budget requires it; the reasons are never
 * dropped. Focus is matched by control kind, not by position, so a hidden idle stop cannot mark the
 * wrong action. A mouse press activates the control through the same index the keyboard uses, so the
 * owning feature keeps a single focused-control model.
 *
 * @param props - Controls, focused kind, per-reason width, and the activation callback.
 * @returns The right-aligned action strip.
 */
export function TopBarActions(props: {
  readonly controls: readonly TopBarControl[];
  readonly focusedKind: TopBarControlKind;
  readonly reasonWidth: number;
  readonly onActivate: (index: number) => void;
}): ReactNode {
  const actions: ButtonProps[] = [];

  props.controls.forEach((control, index) => {
    if (control.kind === "info") {
      return;
    }

    const disabled = !control.available;

    actions.push({
      id: `top-bar-action-${control.kind}`,
      label: control.label,
      icon: control.icon,
      iconOnly: true,
      focused: control.kind === props.focusedKind,
      disabled,
      reason: disabled ? readReason(control.reason, props.reasonWidth) : undefined,
      onPress: () => {
        props.onActivate(index);
      },
    });
  });

  return <ButtonRow actions={actions} />;
}

/**
 * Applies the reason budget to an availability reason.
 *
 * @param reason - Display reason, or null when the control is available.
 * @param reasonWidth - Columns available to the reason.
 * @returns The exact reason, truncated only when it does not fit.
 */
function readReason(reason: string | null, reasonWidth: number): string {
  if (reason === null) {
    return ICONS.ellipsis;
  }

  return truncateText(reason, Math.max(0, reasonWidth), ICONS.ellipsis);
}
