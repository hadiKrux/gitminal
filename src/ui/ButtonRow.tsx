import type { ReactNode } from "react";
import { Button } from "@/ui/Button";
import type { ButtonProps } from "@/ui/Button.types";

/**
 * Renders a horizontal group of composed buttons.
 *
 * The row is presentational: it renders the supplied actions in order and keeps a one-cell gap
 * between them. The focused control index belongs to the owning feature, so the row never tracks
 * focus itself and never reorders actions.
 *
 * @param props - Actions in display order.
 * @returns The button row.
 */
export function ButtonRow(props: { readonly actions: readonly ButtonProps[] }): ReactNode {
  return (
    <box flexDirection="row" flexShrink={0} gap={1}>
      {props.actions.map((action, index) => (
        <Button key={action.id ?? `${index}:${action.label}`} {...action} />
      ))}
    </box>
  );
}
