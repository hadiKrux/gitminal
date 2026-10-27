import type { ReactNode } from "react";
import type { TagRowRecord, TagScopeState } from "@/domain/git/git.types";
import {
  TAG_ROW_INDENT_WIDTH,
  TAG_ROW_MAX_SUBJECT_BUDGET,
  TAG_ROW_MIN_SUBJECT_BUDGET,
  TAG_ROW_SEPARATOR_WIDTH,
  TAG_SCOPE_INDICATOR_WIDTH,
} from "@/features/tags/TagRow.constants";
import type { TagScopeIndicator, TagScopeIndicatorToken } from "@/features/tags/TagRow.types";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import { ListRow } from "@/ui/ListRow";
import { TruncatedText } from "@/ui/TruncatedText";
import { useTerminalDimensions } from "@/ui/useTerminalDimensions";

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
 * The row shows a one-cell indent, the tag name, one scope indicator, and, when the terminal
 * leaves room, the peeled commit subject. It does not use the `ListRow` selection marker: the dark
 * selected fill already identifies the cursor row, and the indent aligns the tag name with the panel
 * filter field. The indicator is a fixed-width bracketed presence matrix:
 * the first slot holds `ICONS.tagLocal` when the tag exists locally and `ICONS.tagScopeAbsent`
 * otherwise, and the second slot holds `ICONS.tagRemote`, `ICONS.tagUnpushed`, `ICONS.tagUnknown`,
 * or `ICONS.tagScopeAbsent`. An unknown remote state therefore renders `[L?]` and never claims the
 * tag is unpushed. The indicator is colored with `tag` when the tag is in sync, `warning` when it
 * needs a push or the remote state is unknown, and `muted` otherwise.
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
  const scope = readScopeIndicator(props.row.state);
  const subjectBudget = readSubjectBudget(dimensions.width, props.row.name);
  const showSubject = props.row.subject.length > 0 && subjectBudget >= TAG_ROW_MIN_SUBJECT_BUDGET;

  return (
    <ListRow
      id={tagRowId(props.row.name)}
      selected={props.selected}
      focused={props.focused}
      showMarker={false}
      onMouseDown={props.onPress}
    >
      <box flexDirection="row" flexShrink={1} overflow="hidden">
        <text wrapMode="none" flexShrink={0}>
          {" "}
        </text>
        <text wrapMode="none" flexShrink={0}>
          {props.row.name}
          <span fg={tokens[scope.token]}>{` ${scope.text}`}</span>
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
 * Reads the bracketed scope indicator for one logical tag state.
 *
 * The local slot is filled for every state that has a local tag. The remote slot carries the
 * remote-scope fact: present, known absent, or unknown. `local` is the domain's unreachable fallback
 * for a remote-only name with no configured remotes, so it renders the same as `local-only`.
 *
 * @param state - Merged scope state from the domain selector.
 * @returns The indicator text and its color token.
 */
function readScopeIndicator(state: TagScopeState): TagScopeIndicator {
  switch (state) {
    case "local":
    case "local-only":
      return scopeIndicator(ICONS.tagLocal, ICONS.tagScopeAbsent, "muted");
    case "remote":
      return scopeIndicator(ICONS.tagScopeAbsent, ICONS.tagRemote, "muted");
    case "both":
      return scopeIndicator(ICONS.tagLocal, ICONS.tagRemote, "tag");
    case "unpushed":
      return scopeIndicator(ICONS.tagLocal, ICONS.tagUnpushed, "warning");
    case "unknown":
      return scopeIndicator(ICONS.tagLocal, ICONS.tagUnknown, "warning");
  }
}

/**
 * Fills both slots of the fixed-width indicator.
 *
 * @param local - Content of the local slot, one cell.
 * @param remote - Content of the remote slot, one cell.
 * @param token - Theme token that colors the indicator.
 * @returns The bracketed indicator.
 */
function scopeIndicator(
  local: string,
  remote: string,
  token: TagScopeIndicatorToken,
): TagScopeIndicator {
  return {
    text: `${ICONS.tagScopeOpen}${local}${remote}${ICONS.tagScopeClose}`,
    token,
  };
}

/**
 * Reads how many characters of the commit subject fit on the row.
 *
 * The tag name and scope indicator are reserved first, so the subject is the only part that
 * truncates or drops. A narrow terminal therefore keeps the identity of the tag readable. The
 * indicator width is constant, so no state makes the budget change.
 * @param width - Current terminal width in cells.
 * @param name - Tag name.
 * @returns The subject budget, possibly zero or negative when no room remains.
 */
function readSubjectBudget(width: number, name: string): number {
  const used =
    TAG_ROW_INDENT_WIDTH +
    name.length +
    TAG_ROW_SEPARATOR_WIDTH +
    TAG_SCOPE_INDICATOR_WIDTH +
    TAG_ROW_SEPARATOR_WIDTH;

  return Math.min(TAG_ROW_MAX_SUBJECT_BUDGET, width - used);
}
