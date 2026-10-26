// biome-ignore-all lint/a11y/noStaticElementInteractions: OpenTUI boxes are the only layout and hit-test primitive; they have no DOM role.
import type { ReactNode } from "react";
import { useTokens } from "@/theme/useTokens";
import { TextMarker } from "@/ui/TextMarker";

/**
 * Renders one custom-content list row with a selection marker and background.
 *
 * The leading marker comes from `TextMarker`: the cursor row shows the selection marker, and a row
 * in a focused region colors that marker with the focus token. The selected row also receives the
 * dark `surface` background token rather than the brighter `selection` token, so a selected row
 * reads as a subtle dark fill and the marker carries the selection signal. The caller composes the
 * row content, including any column split or detail line.
 *
 * A supplied mouse handler only selects or dispatches in the owning feature. This primitive never
 * calls `focus()` and never writes focus state, because OpenTUI native focus follows the click and
 * the region frame owns the focus ring.
 *
 * @param props - Row content, selection and focus flags, optional id, and an optional mouse handler.
 * @returns The composed list row.
 */
export function ListRow(props: {
  readonly children?: ReactNode;
  readonly selected?: boolean;
  readonly focused?: boolean;
  readonly id?: string;
  readonly onMouseDown?: () => void;
}): ReactNode {
  const tokens = useTokens();
  const selected = props.selected === true;

  return (
    <box
      id={props.id}
      flexDirection="row"
      alignItems="flex-start"
      flexShrink={0}
      minHeight={1}
      backgroundColor={selected ? tokens.surface : undefined}
      onMouseDown={props.onMouseDown}
    >
      <TextMarker focused={selected && props.focused === true} selected={selected} />
      <box flexDirection="column" flexGrow={1} flexShrink={1}>
        {props.children}
      </box>
    </box>
  );
}
