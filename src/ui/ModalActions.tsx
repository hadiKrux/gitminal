import type { ReactNode } from "react";
import type { ButtonProps } from "@/ui/Button.types";
import { ButtonRow } from "@/ui/ButtonRow";

/**
 * Renders the footer action row of a modal.
 *
 * The actions are rendered in exactly the order supplied, so the caller owns the order and the
 * default focus decision. For destructive confirmations the caller is expected to focus Cancel;
 * this primitive never reorders or re-labels an action.
 *
 * @param props - Footer actions in display order.
 * @returns The footer action row.
 */
export function ModalActions(props: { readonly actions: readonly ButtonProps[] }): ReactNode {
  return (
    <box flexDirection="row" flexShrink={0} justifyContent="flex-end">
      <ButtonRow actions={props.actions} />
    </box>
  );
}
