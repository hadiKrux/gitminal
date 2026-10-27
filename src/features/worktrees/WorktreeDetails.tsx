import type { ReactNode } from "react";
import { useFocusRegion } from "@/app/hooks/useFocusRegion";
import { useRepository } from "@/app/hooks/useRepository";
import type { WorktreeRecord } from "@/domain/git/git.types";
import {
  WORKTREE_DETAILS_CHROME_WIDTH,
  WORKTREE_DETAILS_MAX_PATH_BUDGET,
  WORKTREE_DETAILS_MIN_PATH_BUDGET,
  WORKTREE_DETAILS_MISSING_TEXT,
  WORKTREE_DETAILS_READ_ONLY_TEXT,
  WORKTREE_DETAILS_SHORT_OID_LENGTH,
} from "@/features/worktrees/WorktreeDetails.constants";
import { readWorktreeLabel } from "@/features/worktrees/WorktreeRow";
import { shortenPath, toHomeRelativePath } from "@/lib/paths";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import { Panel } from "@/ui/Panel";
import { ScrollableList } from "@/ui/ScrollableList";
import { useTerminalDimensions } from "@/ui/useTerminalDimensions";

/**
 * Renders the read-only right-pane summary of the selected worktree.
 *
 * The component renders only for `RepositoryProvider.selection.kind === "worktree"`; every other
 * selection leaves the right pane to its other mode. It owns the `right-pane` region frame, the
 * border title, and its scroll container, so the shell's main area only sizes it. The panel names
 * the branch or the detached short hash, the full and shortened path, the HEAD short hash, and the
 * current, locked, prunable, and dirty state with its reported reason. It never shows diff content
 * and never writes the selection or the repository root, so opening it cannot switch the active
 * repository.
 *
 * A selected path that is gone from the latest snapshot renders "Worktree no longer exists" instead
 * of a stale summary. The exact read-only notice stays visible in both cases.
 *
 * @returns The worktree summary, or null when the selection is not a worktree.
 */
export function WorktreeDetails(): ReactNode {
  const repository = useRepository();
  const region = useFocusRegion("right-pane");
  const tokens = useTokens();
  const dimensions = useTerminalDimensions();
  const selection = repository.selection;

  if (selection.kind !== "worktree") {
    return null;
  }

  const worktree =
    repository.snapshot?.worktrees.find((candidate) => candidate.path === selection.path) ?? null;
  const pathBudget = Math.max(
    WORKTREE_DETAILS_MIN_PATH_BUDGET,
    Math.min(dimensions.width - WORKTREE_DETAILS_CHROME_WIDTH, WORKTREE_DETAILS_MAX_PATH_BUDGET),
  );

  if (worktree === null) {
    return (
      <Panel
        {...region.regionProps}
        focused={region.focused}
        title="Worktree"
        flexGrow={1}
        flexBasis={0}
      >
        <ScrollableList>
          <box flexDirection="column" paddingLeft={1} paddingRight={1}>
            <text fg={tokens.warning} wrapMode="word">
              {`${ICONS.warning} ${WORKTREE_DETAILS_MISSING_TEXT}`}
            </text>
            <text fg={tokens.dim} wrapMode="word">
              {WORKTREE_DETAILS_READ_ONLY_TEXT}
            </text>
          </box>
        </ScrollableList>
      </Panel>
    );
  }

  return (
    <Panel
      {...region.regionProps}
      focused={region.focused}
      title="Worktree"
      flexGrow={1}
      flexBasis={0}
    >
      <ScrollableList>
        <box flexDirection="column" paddingLeft={1} paddingRight={1}>
          <text fg={tokens.text} wrapMode="none">
            {`Worktree: ${readWorktreeLabel(worktree)}`}
          </text>
          <text fg={tokens.muted} wrapMode="word">
            {`Path: ${worktree.path}`}
          </text>
          <text fg={tokens.muted} wrapMode="none">
            {`Short path: ${shortenPath(
              toHomeRelativePath(worktree.path),
              pathBudget,
              ICONS.ellipsis,
            )}`}
          </text>
          <text fg={tokens.muted} wrapMode="none">
            {`HEAD: ${readShortOid(worktree.headOid)}`}
          </text>
          <text fg={tokens.muted} wrapMode="word">
            {`State: ${readStateText(worktree)}`}
          </text>
          <text fg={tokens.dim} wrapMode="word">
            {WORKTREE_DETAILS_READ_ONLY_TEXT}
          </text>
        </box>
      </ScrollableList>
    </Panel>
  );
}

/**
 * Reads the short HEAD hash of one worktree.
 *
 * @param headOid - Full commit id, or null when git reported none.
 * @returns The seven-character id, or "unknown".
 */
function readShortOid(headOid: string | null): string {
  return headOid === null ? "unknown" : headOid.slice(0, WORKTREE_DETAILS_SHORT_OID_LENGTH);
}

/**
 * Reads the state summary of one worktree.
 *
 * A reason is appended in parentheses when git reported one, so a locked or prunable worktree
 * explains itself in words rather than through a marker alone. The dirty state appears only when the
 * snapshot already reports it; a missing dirty read is not described as clean.
 *
 * @param worktree - Worktree from the current snapshot.
 * @returns The joined state text, or "no state flags reported".
 */
function readStateText(worktree: WorktreeRecord): string {
  const parts: string[] = [];

  if (worktree.current) {
    parts.push("current worktree");
  }

  if (worktree.locked) {
    parts.push(withReason("locked", worktree.lockReason));
  }

  if (worktree.prunable) {
    parts.push(withReason("prunable", worktree.pruneReason));
  }

  if (worktree.dirty) {
    parts.push("dirty");
  }

  return parts.length === 0 ? "no state flags reported" : parts.join(` ${ICONS.hintSeparator} `);
}

/**
 * Appends a reported reason to one state label.
 *
 * @param label - State label, such as "locked".
 * @param reason - Reported reason, or null when the state stands alone.
 * @returns The label with its reason when one exists.
 */
function withReason(label: string, reason: string | null): string {
  return reason === null ? label : `${label} (${reason})`;
}
