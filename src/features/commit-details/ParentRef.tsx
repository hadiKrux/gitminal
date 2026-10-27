import type { ReactNode } from "react";
import {
  COMMIT_PARENT_ROW_ID_PREFIX,
  COMMIT_PARENT_SUBJECT_MAX_LENGTH,
} from "@/features/commit-details/useCommitDetails";
import { truncateText } from "@/lib/text";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import { ListRow } from "@/ui/ListRow";
import { useTerminalDimensions } from "@/ui/useTerminalDimensions";

/** Width reserved for the marker, the short hash, and the row padding. */
const PARENT_ROW_RESERVED_WIDTH = 12;

/**
 * Renders one selectable parent row.
 *
 * The row shows the parent's short hash and, when the owner has it, the parent subject. A subject is
 * truncated to the smaller of the documented character cap and the terminal width. A parent load in
 * flight marks the row disabled and prints its reason, so the row stays visible and explains why it
 * cannot be used yet.
 *
 * Every mouse down is reported to the owning cursor. The cursor selects the row and detects a double
 * click, so a double click dispatches the same parent activation as `nav.activate`; this component
 * never detects double clicks itself.
 *
 * @param props - Parent identity, short hash, optional subject, cursor flags, and mouse handler.
 * @returns The composed parent row.
 */
export function ParentRef(props: {
  readonly oid: string;
  readonly shortOid: string;
  readonly subject: string | null;
  readonly selected: boolean;
  readonly focused: boolean;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly onMouseDown: () => void;
}): ReactNode {
  const tokens = useTokens();
  const dimensions = useTerminalDimensions();
  const budget = Math.max(
    8,
    Math.min(COMMIT_PARENT_SUBJECT_MAX_LENGTH, dimensions.width - PARENT_ROW_RESERVED_WIDTH),
  );
  const subject =
    props.subject === null ? null : truncateText(props.subject, budget, ICONS.ellipsis);

  return (
    <ListRow
      id={`${COMMIT_PARENT_ROW_ID_PREFIX}${props.oid}`}
      selected={props.selected}
      focused={props.focused}
      onMouseDown={props.onMouseDown}
    >
      <text wrapMode="none">
        <span fg={tokens.accent}>{props.shortOid}</span>
        {subject === null ? null : <span fg={tokens.muted}>{` ${subject}`}</span>}
      </text>
      {props.disabled === true && props.disabledReason !== undefined ? (
        <text fg={tokens.dim} wrapMode="none">
          {`${ICONS.running} ${props.disabledReason}`}
        </text>
      ) : null}
    </ListRow>
  );
}
