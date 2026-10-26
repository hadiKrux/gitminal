import { useTerminalDimensions } from "@opentui/react";
import type { ReactNode } from "react";
import type { TagRowRecord, TagScopeState } from "@/domain/git/git.types";
import {
  TAG_ROW_MARKER_WIDTH,
  TAG_ROW_MAX_SUBJECT_BUDGET,
  TAG_ROW_MIN_SUBJECT_BUDGET,
  TAG_ROW_SEPARATOR_WIDTH,
  TAG_ROW_UNKNOWN_SCOPE_TEXT,
} from "@/features/tags/TagRow.constants";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import { ListRow } from "@/ui/ListRow";
import { TruncatedText } from "@/ui/TruncatedText";

/**
 * Builds the stable renderable id of one logical tag row.
 *
 * @param name - Tag name, which is the row identity across local and remote scope.
 * @returns The row renderable id.
 */
export function tagRowId(name: string): string {
  return `tag-row:${name}`;
}

/**
 * Renders one logical tag row.
 *
 * The row shows the selection marker, the tag name, one scope indicator, and, when the terminal
 * leaves room, the peeled commit subject. Scope text comes from `ICONS.tagLocal`, `tagRemote`,
 * `tagUnpushed`, and `tagLocalOnly`; an unknown remote state renders the exact text
 * "remote unknown" and never claims the tag is unpushed. A tag present both locally and remotely
 * shows both scope words.
 *
 * The commit subject drops before the tag name and scope indicator. Its budget is derived from
 * `useTerminalDimensions`, and `TruncatedText` applies `@/lib/text` so the rendered string never
 * exceeds the budget.
 *
 * @param props - Row data, selection and focus flags, and the click handler supplied by the cursor.
 * @returns The composed tag row.
 */
export function TagRow(props: {
  readonly row: TagRowRecord;
  readonly selected: boolean;
  readonly focused: boolean;
  readonly onPress: () => void;
}): ReactNode {
  const tokens = useTokens();
  const dimensions = useTerminalDimensions();
  const scopeText = readScopeText(props.row.state);
  const subjectBudget = readSubjectBudget(dimensions.width, props.row.name, scopeText);
  const showSubject = props.row.subject.length > 0 && subjectBudget >= TAG_ROW_MIN_SUBJECT_BUDGET;

  return (
    <ListRow
      id={tagRowId(props.row.name)}
      selected={props.selected}
      focused={props.focused}
      onMouseDown={props.onPress}
    >
      <box flexDirection="row" flexShrink={1} overflow="hidden">
        <text wrapMode="none" flexShrink={0}>
          {props.row.name}
          <span fg={tokens.muted}>{` ${scopeText}`}</span>
        </text>
        {showSubject ? (
          <box flexShrink={1} marginLeft={1}>
            <TruncatedText text={props.row.subject} maxWidth={subjectBudget} fg={tokens.dim} />
          </box>
        ) : null}
      </box>
    </ListRow>
  );
}

/**
 * Reads the visible scope indicator for one logical tag state.
 *
 * @param state - Merged scope state from the domain selector.
 * @returns The scope text, never an empty string.
 */
function readScopeText(state: TagScopeState): string {
  switch (state) {
    case "local":
      return ICONS.tagLocal;
    case "remote":
      return ICONS.tagRemote;
    case "both":
      return `${ICONS.tagLocal} ${ICONS.tagRemote}`;
    case "unpushed":
      return ICONS.tagUnpushed;
    case "local-only":
      return ICONS.tagLocalOnly;
    case "unknown":
      return TAG_ROW_UNKNOWN_SCOPE_TEXT;
  }
}

/**
 * Reads how many characters of the commit subject fit on the row.
 *
 * The tag name and scope indicator are reserved first, so the subject is the only part that
 * truncates or drops. A narrow terminal therefore keeps the identity of the tag readable.
 *
 * @param width - Current terminal width in cells.
 * @param name - Tag name.
 * @param scopeText - Rendered scope indicator text.
 * @returns The subject budget, possibly zero or negative when no room remains.
 */
function readSubjectBudget(width: number, name: string, scopeText: string): number {
  const used =
    TAG_ROW_MARKER_WIDTH +
    name.length +
    TAG_ROW_SEPARATOR_WIDTH +
    scopeText.length +
    TAG_ROW_SEPARATOR_WIDTH;

  return Math.min(TAG_ROW_MAX_SUBJECT_BUDGET, width - used);
}
