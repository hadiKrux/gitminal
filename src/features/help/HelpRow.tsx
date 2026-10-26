import type { ReactNode } from "react";
import {
  HELP_DETAIL_MIN_BUDGET,
  HELP_KEY_SEPARATOR,
  HELP_LABEL_BUDGET,
  HELP_ROW_SPACING,
  HELP_UNBOUND_LABEL,
} from "@/features/help/HelpRow.constants";
import { HELP_ROW_ID_PREFIX } from "@/features/help/useHelp.constants";
import type { HelpRowView } from "@/features/help/useHelp.types";
import { truncateText } from "@/lib/text";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import { ListRow } from "@/ui/ListRow";

/**
 * Renders one help row.
 *
 * The row always shows the action name, its effective keys or "Unbound", and a one-line description.
 * An action that cannot run now keeps both and adds the exact shared availability reason with the
 * `[!]` marker, so a disabled action never looks runnable and is never filtered out. The keys cell is
 * never truncated away: the name and description carry the budget instead. Keys and the reason are
 * inline `<span>` runs inside `<text>`, and the marker comes from `ICONS`.
 *
 * @param props - Row data, available text width, selection state, and the click handler.
 * @returns The composed help row.
 */
export function HelpRow(props: {
  readonly row: HelpRowView;
  readonly width: number;
  readonly selected: boolean;
  readonly onSelect: () => void;
}): ReactNode {
  const tokens = useTokens();
  const keys = props.row.keys.join(HELP_KEY_SEPARATOR);
  const detailBudget = Math.max(
    HELP_DETAIL_MIN_BUDGET,
    props.width - HELP_LABEL_BUDGET - keys.length - HELP_ROW_SPACING,
  );

  return (
    <ListRow
      id={`${HELP_ROW_ID_PREFIX}${props.row.actionId}`}
      selected={props.selected}
      focused={props.selected}
      onMouseDown={props.onSelect}
    >
      <box flexDirection="row" gap={1}>
        <text wrapMode="none" flexShrink={0} width={HELP_LABEL_BUDGET}>
          <span fg={tokens.text}>
            {truncateText(props.row.label, HELP_LABEL_BUDGET, ICONS.ellipsis)}
          </span>
        </text>
        <text wrapMode="none" flexShrink={0}>
          <span fg={props.row.keys.length === 0 ? tokens.dim : tokens.accent}>
            {props.row.keys.length === 0 ? HELP_UNBOUND_LABEL : keys}
          </span>
        </text>
        <text wrapMode="none" flexShrink={1}>
          <span fg={props.row.unavailableReason === null ? tokens.muted : tokens.warning}>
            {truncateText(readDetailText(props.row), detailBudget, ICONS.ellipsis)}
          </span>
        </text>
      </box>
    </ListRow>
  );
}

/**
 * Builds the description line of one row.
 *
 * The availability reason comes first so a narrow modal never truncates it away, and the description
 * follows it on the same line.
 *
 * @param row - Row being rendered.
 * @returns The reason and description, or just the description when the action can run now.
 */
function readDetailText(row: HelpRowView): string {
  if (row.unavailableReason === null) {
    return row.description;
  }

  return `${ICONS.warning} ${row.unavailableReason} ${ICONS.hintSeparator} ${row.description}`;
}
