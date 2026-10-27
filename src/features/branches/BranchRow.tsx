import type { ReactNode } from "react";
import type { BranchRecord } from "@/domain/git/git.types";
import {
  BRANCH_ROW_CONTENT_MAX_WIDTH,
  BRANCH_ROW_CONTENT_MIN_WIDTH,
  BRANCH_ROW_MARKERS_WIDTH,
  BRANCH_ROW_MIN_NAME_WIDTH,
  BRANCH_ROW_STATE_SEPARATOR_WIDTH,
} from "@/features/branches/BranchRow.constants";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import { ListRow } from "@/ui/ListRow";
import { TruncatedText } from "@/ui/TruncatedText";
import { useTerminalDimensions } from "@/ui/useTerminalDimensions";

/**
 * Renders one local branch row.
 *
 * The row shows the current or worktree marker, the branch name, and the upstream state. The
 * marker column is one cell because a branch cannot be both the current branch and checked out in
 * another worktree. A tracked branch shows the push icon with its ahead count and the pull icon
 * with its behind count; a branch without an upstream shows "no upstream"; a configured upstream
 * that is missing locally shows the exact "[?] upstream not found" or "[?] remote branch deleted"
 * text, and the counts are hidden because they describe a ref that is not there. The selected row
 * adds detail lines for the worktree path and for the upstream explanation plus the reason Delete is
 * disabled, so a state is never conveyed by color or a marker alone. The current-branch reason is not
 * repeated here, because pressing Delete opens the modal that states it.
 *
 * The row does not use the `ListRow` selection marker: the dark selected fill already identifies the
 * cursor row, and the current branch has its own marker.
 *
 * The name and the worktree path are truncated with `@/lib/text` through `TruncatedText`, using a
 * budget from the terminal width. The marker run and the state text are never truncated, because a
 * missing upstream indicator must stay readable.
 *
 * @param props - Branch record, selection and focus flags, the delete reason, and the row mouse handler.
 * @returns The composed branch row.
 */
export function BranchRow(props: {
  readonly branch: BranchRecord;
  readonly selected: boolean;
  readonly focused: boolean;
  readonly deleteReason: string | null;
  readonly onMouseDown?: () => void;
}): ReactNode {
  const tokens = useTokens();
  const dimensions = useTerminalDimensions();
  const width = Math.max(
    BRANCH_ROW_CONTENT_MIN_WIDTH,
    Math.min(dimensions.width, BRANCH_ROW_CONTENT_MAX_WIDTH),
  );
  const stateText = readStateText(props.branch);
  const nameBudget = Math.max(
    BRANCH_ROW_MIN_NAME_WIDTH,
    width - BRANCH_ROW_MARKERS_WIDTH - BRANCH_ROW_STATE_SEPARATOR_WIDTH - stateText.length,
  );
  const worktreeDetail = props.selected ? readWorktreeDetail(props.branch) : null;
  const explanation = props.selected
    ? readExplanationDetail(props.branch, props.deleteReason)
    : null;
  const stateColor =
    props.branch.upstreamStatus === "tracked" || props.branch.upstreamStatus === "none"
      ? tokens.muted
      : tokens.warning;
  const marker = readMarker(props.branch);

  return (
    <ListRow
      id={`branch-row-${props.branch.name}`}
      selected={props.selected}
      focused={props.focused}
      showMarker={false}
      onMouseDown={props.onMouseDown}
    >
      <box flexDirection="row" flexShrink={1}>
        <text wrapMode="none" flexShrink={0}>
          <span fg={marker === " " ? tokens.muted : tokens.accent}>{marker}</span>
          <span fg={tokens.muted}> </span>
        </text>
        <TruncatedText text={props.branch.name} maxWidth={nameBudget} />
        {stateText.length === 0 ? null : (
          <text fg={stateColor} wrapMode="none">
            {` ${stateText}`}
          </text>
        )}
      </box>
      {worktreeDetail === null ? null : (
        <TruncatedText text={worktreeDetail} maxWidth={width} fg={tokens.muted} />
      )}
      {explanation === null ? null : (
        <text fg={tokens.muted} wrapMode="word">
          {explanation}
        </text>
      )}
    </ListRow>
  );
}

/**
 * Reads the leading marker for one branch row.
 *
 * A branch cannot be the current branch and checked out in another worktree at the same time, so
 * one column holds whichever marker applies and a plain branch gets a blank cell that keeps every
 * name aligned.
 *
 * @param branch - Branch record from the repository selector.
 * @returns The current marker, the worktree marker, or one space.
 */
function readMarker(branch: BranchRecord): string {
  if (branch.head) {
    return ICONS.currentBranch;
  }

  return branch.worktreePath === null ? " " : ICONS.worktree;
}

/**
 * Reads the inline upstream state for one branch.
 *
 * Ahead and behind counts are reported only for a tracked upstream or a still-unchecked upstream.
 * A `notFound` or `deleted` classification hides them, because the compared ref no longer exists.
 *
 * @param branch - Branch record from the repository selector.
 * @returns The state text, empty when a tracked branch is level with its upstream.
 */
function readStateText(branch: BranchRecord): string {
  switch (branch.upstreamStatus) {
    case "none":
      return "no upstream";
    case "notFound":
      return `${ICONS.missingUpstream} upstream not found`;
    case "deleted":
      return `${ICONS.missingUpstream} remote branch deleted`;
    case "unknown":
      return joinParts([readCountsText(branch), `${ICONS.missingUpstream} upstream unknown`]);
    case "tracked":
      return readCountsText(branch);
  }
}

/**
 * Reads the ahead and behind counts with their push and pull icons.
 *
 * @param branch - Branch record from the repository selector.
 * @returns The non-zero counts joined with one space, or an empty string when level.
 */
function readCountsText(branch: BranchRecord): string {
  const parts: string[] = [];

  if (branch.ahead > 0) {
    parts.push(`${ICONS.push}${branch.ahead}`);
  }

  if (branch.behind > 0) {
    parts.push(`${ICONS.pull}${branch.behind}`);
  }

  return parts.join(" ");
}

/**
 * Reads the worktree detail line for the selected row.
 *
 * The path is truncated to the row budget, because a worktree path can be arbitrarily long and the
 * `+` marker alone does not say where the branch is checked out.
 *
 * @param branch - Branch record from the repository selector.
 * @returns The detail line, or null when no other worktree holds the branch.
 */
function readWorktreeDetail(branch: BranchRecord): string | null {
  return branch.worktreePath === null ? null : `checked out in ${branch.worktreePath}`;
}

/**
 * Reads the explanation line for the selected row.
 *
 * The explanation spells out a missing or unchecked upstream and repeats the availability text that
 * disables Delete for this branch, so neither state depends on the `[?]` marker or on color. It wraps
 * instead of truncating so the reason is readable in a narrow sidebar.
 *
 * @param branch - Branch record from the repository selector.
 * @param deleteReason - Availability text for `branch.delete`, or null when it is available.
 * @returns The explanation, or null when there is nothing to explain.
 */
function readExplanationDetail(branch: BranchRecord, deleteReason: string | null): string | null {
  const parts: string[] = [];
  const upstream = readUpstreamExplanation(branch);

  if (upstream !== null) {
    parts.push(upstream);
  }

  if (deleteReason !== null) {
    parts.push(deleteReason);
  }

  return parts.length === 0 ? null : parts.join(` ${ICONS.hintSeparator} `);
}

/**
 * Explains a configured upstream that cannot supply ahead and behind counts.
 *
 * @param branch - Branch record from the repository selector.
 * @returns The explanation, or null for a tracked or absent upstream.
 */
function readUpstreamExplanation(branch: BranchRecord): string | null {
  const upstream = branch.upstream ?? "the upstream";

  switch (branch.upstreamStatus) {
    case "notFound":
      return `${upstream} is not present locally`;
    case "deleted":
      return `${upstream} was deleted from the remote`;
    case "unknown":
      return `the remote check for ${upstream} did not complete`;
    case "none":
    case "tracked":
      return null;
  }
}

/**
 * Joins the non-empty parts of an inline text run.
 *
 * @param parts - Candidate parts.
 * @returns The parts joined with one space.
 */
function joinParts(parts: readonly string[]): string {
  return parts.filter((part) => part.length > 0).join(" ");
}
