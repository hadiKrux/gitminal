import type { ReactNode } from "react";
import type { StashRecord } from "@/domain/git/git.types";
import {
  STASH_ROW_CONTENT_MAX_WIDTH,
  STASH_ROW_CONTENT_MIN_WIDTH,
  STASH_ROW_IDENTITY_SEPARATOR_WIDTH,
  STASH_ROW_INDENT_WIDTH,
  STASH_ROW_MAX_BRANCH_WIDTH,
  STASH_ROW_MIN_BRANCH_WIDTH,
  STASH_ROW_MIN_MESSAGE_BUDGET,
} from "@/features/stashes/StashRow.constants";
import { formatStashAge } from "@/features/stashes/stash.age";
import { readStashMessage } from "@/features/stashes/stash.prefill";
import { useTokens } from "@/theme/useTokens";
import { ListRow } from "@/ui/ListRow";
import { TruncatedText } from "@/ui/TruncatedText";
import { useTerminalDimensions } from "@/ui/useTerminalDimensions";

/**
 * Builds the stable renderable id of one stash row.
 *
 * The id comes from the immutable object name, never the display index, so the shell scroll target
 * and the row identity survive an external stash operation that renumbers the list.
 *
 * @param objectName - Immutable stash object name.
 * @returns The row renderable id.
 */
export function stashRowId(objectName: string): string {
  return `stash-row:${objectName}`;
}

/**
 * Renders one stash row.
 *
 * The identity line shows a one-cell indent, the display index (`stash@{n}`), the source branch when
 * git recorded one, and the relative age. The row does not use the `ListRow` selection marker: the
 * dark selected fill already identifies the cursor row, and the indent keeps every line aligned with
 * the sibling panels. The message line follows and is the only part that truncates, so a narrow
 * sidebar keeps the index and the age readable. The row id is derived from the immutable object name,
 * never from the display index, so an external stash operation that renumbers the list cannot move
 * the row's identity.
 *
 * @param props - Stash record, selection and focus flags, and the row mouse handler.
 * @returns The composed stash row.
 */
export function StashRow(props: {
  readonly stash: StashRecord;
  readonly selected: boolean;
  readonly focused: boolean;
  readonly onMouseDown?: () => void;
}): ReactNode {
  const tokens = useTokens();
  const dimensions = useTerminalDimensions();
  const terminalWidth = Math.max(1, dimensions.width);
  const width = clampWidth(terminalWidth);
  const age = formatStashAge(props.stash.committedAt);
  const branchBudget = readBranchBudget(width, props.stash, age);
  const messageBudget =
    Math.min(terminalWidth, STASH_ROW_CONTENT_MAX_WIDTH) - STASH_ROW_INDENT_WIDTH;
  const showMessage = messageBudget >= STASH_ROW_MIN_MESSAGE_BUDGET;

  return (
    <ListRow
      id={stashRowId(props.stash.objectName)}
      selected={props.selected}
      focused={props.focused}
      showMarker={false}
      onMouseDown={props.onMouseDown}
    >
      <box flexDirection="column" paddingLeft={STASH_ROW_INDENT_WIDTH}>
        <box flexDirection="row" flexShrink={0} overflow="hidden">
          <text fg={tokens.accent} wrapMode="none" flexShrink={0}>
            {props.stash.index}
          </text>
          {branchBudget === 0 || props.stash.sourceBranch === null ? null : (
            <TruncatedText
              text={` ${props.stash.sourceBranch}`}
              maxWidth={branchBudget + STASH_ROW_IDENTITY_SEPARATOR_WIDTH}
              fg={tokens.muted}
            />
          )}
          <text fg={tokens.muted} wrapMode="none" flexShrink={0}>
            {` ${age}`}
          </text>
        </box>
        {showMessage ? (
          <TruncatedText text={readStashMessage(props.stash)} maxWidth={messageBudget} />
        ) : null}
      </box>
    </ListRow>
  );
}

/**
 * Clamps the terminal width to the row's readable range.
 *
 * @param terminalWidth - Current terminal width in cells.
 * @returns The row content width.
 */
function clampWidth(terminalWidth: number): number {
  return Math.max(
    STASH_ROW_CONTENT_MIN_WIDTH,
    Math.min(terminalWidth, STASH_ROW_CONTENT_MAX_WIDTH),
  );
}

/**
 * Reads how much room the source branch may take on the identity line.
 *
 * The index and the relative age are reserved first, so a long branch shortens before either of
 * them. A branch that cannot keep its minimum width is omitted rather than squeezed.
 *
 * @param width - Row content width.
 * @param stash - Stash record.
 * @param age - Already formatted relative age.
 * @returns The branch budget including its leading separator, or zero when it is omitted.
 */
function readBranchBudget(width: number, stash: StashRecord, age: string): number {
  if (stash.sourceBranch === null) {
    return 0;
  }

  const remaining = width - stash.index.length - age.length - STASH_ROW_IDENTITY_SEPARATOR_WIDTH;
  const budget = Math.min(stash.sourceBranch.length, STASH_ROW_MAX_BRANCH_WIDTH, remaining - 1);

  return budget >= STASH_ROW_MIN_BRANCH_WIDTH ? budget : 0;
}
