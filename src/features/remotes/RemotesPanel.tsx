import type { ReactNode } from "react";
import { RemoteRow } from "@/features/remotes/RemoteRow";
import {
  REMOTES_EMPTY_HINT,
  REMOTES_EMPTY_MESSAGE,
  REMOTES_EMPTY_REPOSITORY_HINT,
  REMOTES_ERROR_MESSAGE,
  REMOTES_LOADING_LABEL,
  REMOTES_NO_REMOTES_MESSAGE,
  REMOTES_OPERATION_IN_PROGRESS,
  REMOTES_TRUNCATION_LABEL,
} from "@/features/remotes/RemotesPanel.constants";
import { useRemotes } from "@/features/remotes/useRemotes";
import type { RemoteBranchGroup } from "@/features/remotes/useRemotes.types";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import { EmptyState } from "@/ui/EmptyState";
import { ErrorState } from "@/ui/ErrorState";
import { LoadingRow } from "@/ui/LoadingRow";

/**
 * Renders the remotes panel body.
 *
 * The shell owns the focusable frame, the border title with the remote-branch count, and the scroll
 * container, so this component returns only the grouped branch rows, and the state
 * rows. It renders no second title row. It never renders a second frame or scrollbox and never
 * registers an action; `useRemotes` owns the scoped registrations and the create-local-branch modal.
 *
 * @returns The remotes panel body.
 */
export function RemotesPanel(): ReactNode {
  const remotes = useRemotes();
  const tokens = useTokens();

  return (
    <box flexDirection="column" flexShrink={0}>
      {remotes.hiddenCount === 0 ? null : (
        <text fg={tokens.dim} wrapMode="none">
          {`${REMOTES_TRUNCATION_LABEL} ${remotes.branchCount} of ${remotes.filteredCount} remote branches (${remotes.hiddenCount} hidden)`}
        </text>
      )}
      {renderReadState(remotes, tokens)}
      {remotes.operationInProgress ? (
        <text fg={tokens.dim} wrapMode="word">
          {`${ICONS.running} ${REMOTES_OPERATION_IN_PROGRESS}`}
        </text>
      ) : null}
    </box>
  );
}

/**
 * Renders the loading, empty, error, or grouped-row content of the panel.
 *
 * A failed read keeps any rows from the previous snapshot visible and appends the inline error with
 * its Retry action. The loading row only covers the first read, because a later read keeps the
 * previous rows on screen. The read-state decisions live in small helpers so no single render branch
 * table grows with the panel.
 *
 * @param view - Panel hook value.
 * @param tokens - Active theme tokens.
 * @returns The body content for the current read state.
 */
function renderReadState(
  view: ReturnType<typeof useRemotes>,
  tokens: ReturnType<typeof useTokens>,
): ReactNode {
  const unavailable = renderUnavailableState(view);

  if (unavailable !== null) {
    return unavailable;
  }

  if (view.groups.length === 0) {
    return renderEmptyGroups(view);
  }

  return renderGroupedRows(view, tokens);
}

/**
 * Renders the error, loading, or no-remote state that replaces the rows entirely.
 *
 * @param view - Panel hook value.
 * @returns The state content, or null when the rows should render.
 */
function renderUnavailableState(view: ReturnType<typeof useRemotes>): ReactNode {
  if (view.loadError !== null && view.groups.length === 0) {
    return (
      <ErrorState message={REMOTES_ERROR_MESSAGE} details={view.loadError} onRetry={view.retry} />
    );
  }

  if (view.loading) {
    return <LoadingRow label={REMOTES_LOADING_LABEL} />;
  }

  if (view.noRemotes) {
    return <EmptyState message={REMOTES_NO_REMOTES_MESSAGE} />;
  }

  return null;
}

/**
 * Renders the empty state for a readable repository with no matching rows.
 *
 * @param view - Panel hook value.
 * @returns The empty or no-match message.
 */
function renderEmptyGroups(view: ReturnType<typeof useRemotes>): ReactNode {
  return (
    <EmptyState
      message={REMOTES_EMPTY_MESSAGE}
      hint={view.emptyRepository ? REMOTES_EMPTY_REPOSITORY_HINT : REMOTES_EMPTY_HINT}
    />
  );
}

/**
 * Renders every remote group plus the inline error for a failed later read.
 *
 * @param view - Panel hook value.
 * @param tokens - Active theme tokens.
 * @returns The grouped rows and optional inline error.
 */
function renderGroupedRows(
  view: ReturnType<typeof useRemotes>,
  tokens: ReturnType<typeof useTokens>,
): ReactNode {
  return (
    <box flexDirection="column" flexShrink={0}>
      {view.groups.map((group) => renderGroup(view, group, tokens))}
      {view.loadError === null ? null : (
        <ErrorState message={REMOTES_ERROR_MESSAGE} details={view.loadError} onRetry={view.retry} />
      )}
    </box>
  );
}

/**
 * Renders one remote group header and its branch rows.
 *
 * @param view - Panel hook value.
 * @param group - Grouped remote branches from the selector, optionally filtered.
 * @param tokens - Active theme tokens.
 * @returns The group header and its rows.
 */
function renderGroup(
  view: ReturnType<typeof useRemotes>,
  group: RemoteBranchGroup,
  tokens: ReturnType<typeof useTokens>,
): ReactNode {
  return (
    <box key={group.remote} flexDirection="column" flexShrink={0}>
      <box height={1} paddingLeft={1} flexDirection="row" flexShrink={0}>
        <text fg={tokens.muted} wrapMode="none">
          {group.remote}
        </text>
        <text fg={tokens.dim} wrapMode="none">
          {` (${group.branches.length})`}
        </text>
      </box>
      {group.branches.map((branch) => {
        const id = `remote-row-${group.remote}-${branch.branch}`;
        const index = view.rowIndexById.get(id) ?? 0;

        return (
          <RemoteRow
            key={id}
            id={id}
            remote={group.remote}
            branch={branch.branch}
            hasLocalTracker={branch.hasLocalTracker}
            freshness={view.freshnessByRemote[group.remote] ?? "unknown"}
            selected={view.cursor.index === index}
            focused={view.focused}
            onMouseDown={() => view.selectRow(index)}
          />
        );
      })}
    </box>
  );
}
