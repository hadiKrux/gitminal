import type { ReactNode } from "react";
import type { WorktreeRecord } from "@/domain/git/git.types";
import {
  WORKTREE_ROW_CONTENT_MAX_WIDTH,
  WORKTREE_ROW_CONTENT_MIN_WIDTH,
  WORKTREE_ROW_INDENT_WIDTH,
  WORKTREE_ROW_MIN_PATH_BUDGET,
  WORKTREE_ROW_SHORT_OID_LENGTH,
} from "@/features/worktrees/WorktreeRow.constants";
import { shortenPath, toHomeRelativePath } from "@/lib/paths";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import { ListRow } from "@/ui/ListRow";
import { useTerminalDimensions } from "@/ui/useTerminalDimensions";

/**
 * Builds the stable renderable id of one worktree row.
 *
 * The absolute path is the worktree identity, so the row id, the persisted cursor, and the shell
 * scroll target all survive a branch rename or a list reorder.
 *
 * @param path - Absolute worktree path.
 * @returns The row renderable id.
 */
export function worktreeRowId(path: string): string {
  return `worktree-row:${path}`;
}

/**
 * Renders one worktree row.
 *
 * The row shows a one-cell indent, the branch name or the detached short hash, the inline current,
 * locked, prunable, and dirty markers, and the shortened path. It does not use the `ListRow`
 * selection marker: the dark selected fill already identifies the cursor row, and the indent keeps
 * every line of the row aligned with the padded filter field. A selected row adds one detail line that spells every active state and its reason, so a marker is never the
 * only signal and a lock or prune reason is readable in the sidebar. The dirty marker is rendered
 * only when the snapshot already reports `dirty`; the feature never invents a dirty read.
 *
 * The path is abbreviated with `@/lib/paths.shortenPath`, which keeps the tail, and its budget comes
 * from `useTerminalDimensions`. The branch name and the markers are never truncated, so the
 * identity of the worktree stays readable.
 *
 * @param props - Worktree record, selection and focus flags, and the row mouse handler.
 * @returns The composed worktree row.
 */
export function WorktreeRow(props: {
  readonly row: WorktreeRecord;
  readonly selected: boolean;
  readonly focused: boolean;
  readonly onPress: () => void;
}): ReactNode {
  const tokens = useTokens();
  const dimensions = useTerminalDimensions();
  const width = Math.max(
    WORKTREE_ROW_CONTENT_MIN_WIDTH,
    Math.min(dimensions.width, WORKTREE_ROW_CONTENT_MAX_WIDTH),
  );
  const pathBudget = Math.max(WORKTREE_ROW_MIN_PATH_BUDGET, width - WORKTREE_ROW_INDENT_WIDTH);
  const displayPath = shortenPath(toHomeRelativePath(props.row.path), pathBudget, ICONS.ellipsis);
  const detail = props.selected ? readStateDetail(props.row) : null;

  return (
    <ListRow
      id={worktreeRowId(props.row.path)}
      selected={props.selected}
      focused={props.focused}
      showMarker={false}
      onMouseDown={props.onPress}
    >
      <box flexDirection="column" paddingLeft={1}>
        <box flexDirection="row" flexShrink={1}>
          <text wrapMode="none" flexShrink={0}>
            {`${readWorktreeLabel(props.row)} `}
            {props.row.current ? <span fg={tokens.accent}>{`${ICONS.currentBranch} `}</span> : null}
            {props.row.locked ? <span fg={tokens.warning}>{`${ICONS.locked} `}</span> : null}
            {props.row.prunable ? <span fg={tokens.warning}>{`${ICONS.prunable} `}</span> : null}
            {props.row.dirty ? <span fg={tokens.warning}>{ICONS.dirty}</span> : null}
          </text>
        </box>
        <text fg={tokens.muted} wrapMode="none" flexShrink={1}>
          {displayPath}
        </text>
        {detail === null ? null : (
          <text fg={tokens.muted} wrapMode="word">
            {detail}
          </text>
        )}
      </box>
    </ListRow>
  );
}

/**
 * Reads the branch name or the detached short hash of one worktree.
 *
 * A worktree with a branch uses the branch name. A detached worktree uses the `~` marker plus the
 * first seven characters of HEAD, which is the same detached identity the rest of the app shows.
 * The `~` marker is never the only signal, because the short hash follows it.
 *
 * @param row - Worktree record from the repository selector.
 * @returns The identity text for the row.
 */
export function readWorktreeLabel(row: WorktreeRecord): string {
  if (row.branch !== null) {
    return row.branch;
  }

  const shortHash =
    row.headOid === null ? "detached" : row.headOid.slice(0, WORKTREE_ROW_SHORT_OID_LENGTH);

  return `${ICONS.detached} ${shortHash}`;
}

/**
 * Reads the selected-row detail line naming every active state and its reason.
 *
 * @param row - Worktree record from the repository selector.
 * @returns The joined detail text, or null when the worktree has no reported state.
 */
function readStateDetail(row: WorktreeRecord): string | null {
  const parts: string[] = [];

  if (row.current) {
    parts.push("current worktree");
  }

  if (row.locked) {
    parts.push(row.lockReason === null ? "locked" : `locked: ${row.lockReason}`);
  }

  if (row.prunable) {
    parts.push(row.pruneReason === null ? "prunable" : `prunable: ${row.pruneReason}`);
  }

  if (row.dirty) {
    parts.push("dirty");
  }

  return parts.length === 0 ? null : parts.join(` ${ICONS.hintSeparator} `);
}
