import {
  DELETE_BRANCH_BORDER_WIDTH,
  DELETE_BRANCH_COMMIT_PREFIX_WIDTH,
  DELETE_BRANCH_FOOTER_CHROME_WIDTH,
  DELETE_BRANCH_MIN_SUBJECT_WIDTH,
  DELETE_BRANCH_MODAL_HEIGHT,
  DELETE_BRANCH_MODAL_MAX_HEIGHT,
  DELETE_BRANCH_MODAL_WIDTH,
  DELETE_BRANCH_NOTICE_ROWS,
  DELETE_BRANCH_RESERVED_ROWS,
  DELETE_BRANCH_SCROLLBAR_WIDTH,
} from "@/features/branches/DeleteBranchModal.constants";
import type {
  BranchRiskState,
  DeleteBranchCommitBudget,
  DeleteBranchLayout,
} from "@/features/branches/DeleteBranchModal.types";
import { truncateText } from "@/lib/text";
import { ICONS } from "@/theme/icons";
import {
  MODAL_HORIZONTAL_INSET,
  MODAL_MIN_HEIGHT,
  MODAL_MIN_WIDTH,
  MODAL_VERTICAL_INSET,
} from "@/ui/ModalFrame.constants";

/**
 * Reads the commit budget one risk state contributes to the layout.
 *
 * @param risk - Current at-risk read state.
 * @returns The displayed commit count and cap indicator, both zero or false while loading.
 */
export function readDeleteBranchCommitBudget(risk: BranchRiskState): DeleteBranchCommitBudget {
  if (risk.status === "loading") {
    return { commitCount: 0, hasMore: false };
  }

  return { commitCount: risk.commits.length, hasMore: risk.hasMore };
}

/**
 * Computes the modal height and the at-risk row budgets for the current terminal.
 *
 * The modal grows with the at-risk list up to its documented maximum, then clamps to the terminal
 * the same way `ModalFrame` does. The scrollbox receives only the rows left after the fixed modal
 * content, so the force checkbox, the acknowledgement line, and the footer keep their reserved rows.
 * Every fixed line is rendered on one row, so the branch-name length never changes this budget.
 *
 * @param input - Terminal size and the number of commits the read will show.
 * @returns The modal height, scrollbox height, content width, and per-row subject budget.
 */
export function readDeleteBranchLayout(input: {
  readonly terminalWidth: number;
  readonly terminalHeight: number;
  readonly commitCount: number;
  readonly hasMore: boolean;
}): DeleteBranchLayout {
  const modalHeight = readModalHeight(input.terminalHeight, input.commitCount, input.hasMore);
  const contentWidth = readModalWidth(input.terminalWidth) - DELETE_BRANCH_BORDER_WIDTH;
  const listHeight = Math.max(
    0,
    Math.min(input.commitCount, modalHeight - DELETE_BRANCH_RESERVED_ROWS),
  );

  return {
    modalHeight,
    listHeight,
    subjectWidth: readSubjectWidth(contentWidth),
    contentWidth,
  };
}

/**
 * Fits the footer labels into the modal content width.
 *
 * The footer always keeps Cancel and the destructive confirmation inside the border. Cancel is
 * preserved first because it is the safe exit, and the confirm label is truncated only when the two
 * labels together cannot fit the content width after the button padding and gap.
 *
 * @param input - Content width and the two untruncated labels.
 * @returns Labels that fit the footer row.
 */
export function readDeleteBranchFooterLabels(input: {
  readonly contentWidth: number;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
}): { readonly confirmLabel: string; readonly cancelLabel: string } {
  const budget = Math.max(0, input.contentWidth - DELETE_BRANCH_FOOTER_CHROME_WIDTH);

  if (input.confirmLabel.length + input.cancelLabel.length <= budget) {
    return { confirmLabel: input.confirmLabel, cancelLabel: input.cancelLabel };
  }

  const cancelLabel = truncateText(input.cancelLabel, budget, ICONS.ellipsis);
  const confirmLabel = truncateText(
    input.confirmLabel,
    Math.max(0, budget - cancelLabel.length),
    ICONS.ellipsis,
  );

  return { confirmLabel, cancelLabel };
}

/**
 * Reads the modal height for the current terminal.
 *
 * @param terminalHeight - Terminal rows.
 * @param commitCount - Commits the read will show.
 * @param hasMore - True when the hidden-count notice also needs a row.
 * @returns The requested height after the terminal clamp.
 */
function readModalHeight(terminalHeight: number, commitCount: number, hasMore: boolean): number {
  const requested =
    DELETE_BRANCH_MODAL_HEIGHT + commitCount + (hasMore ? DELETE_BRANCH_NOTICE_ROWS : 0);
  const available = Math.max(MODAL_MIN_HEIGHT, terminalHeight - MODAL_VERTICAL_INSET * 2);

  return Math.max(MODAL_MIN_HEIGHT, Math.min(requested, DELETE_BRANCH_MODAL_MAX_HEIGHT, available));
}

/**
 * Reads the subject budget for one at-risk row.
 *
 * @param contentWidth - Drawable width inside the modal border.
 * @returns The columns left for a commit subject after the id and scrollbar.
 */
function readSubjectWidth(contentWidth: number): number {
  const budget = contentWidth - DELETE_BRANCH_COMMIT_PREFIX_WIDTH - DELETE_BRANCH_SCROLLBAR_WIDTH;

  return Math.max(DELETE_BRANCH_MIN_SUBJECT_WIDTH, budget);
}

/**
 * Reads the clamped modal width.
 *
 * @param terminalWidth - Terminal columns.
 * @returns The width the frame will use.
 */
function readModalWidth(terminalWidth: number): number {
  const available = Math.max(MODAL_MIN_WIDTH, terminalWidth - MODAL_HORIZONTAL_INSET * 2);

  return Math.max(MODAL_MIN_WIDTH, Math.min(DELETE_BRANCH_MODAL_WIDTH, available, terminalWidth));
}
