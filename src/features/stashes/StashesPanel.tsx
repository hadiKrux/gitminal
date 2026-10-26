import { type ReactNode, useCallback } from "react";
import { useScrollSelectedRow } from "@/app/hooks/useScrollSelectedRow";
import { CreateStashModal } from "@/features/stashes/CreateStashModal";
import { DeleteStashModal } from "@/features/stashes/DeleteStashModal";
import {
  STASHES_BUSY_MESSAGE,
  STASHES_EMPTY_MESSAGE,
  STASHES_ERROR_MESSAGE,
  STASHES_LOADING_LABEL,
  STASHES_TRUNCATION_LABEL,
} from "@/features/stashes/StashesPanel.constants";
import { StashRow, stashRowId } from "@/features/stashes/StashRow";
import { useStashes } from "@/features/stashes/useStashes";
import { useTokens } from "@/theme/useTokens";
import { EmptyState } from "@/ui/EmptyState";
import { ErrorState } from "@/ui/ErrorState";
import { LoadingRow } from "@/ui/LoadingRow";

/**
 * Renders the body of the Stashes sidebar panel.
 *
 * The shell already supplies the focusable panel frame, the border title with the count, and the
 * scroll container, so this component returns only the stash rows, the truncation notice, and the
 * loading, empty, error, and read-only state rows. It never renders a second panel, header, or
 * scrollbox.
 *
 * Rows come from `useStashes`, which reads `selectStashRows` and keeps newest-first ordering,
 * source branches, and relative ages as the repository reports them. The active row id is passed to
 * `useScrollSelectedRow`, so keyboard navigation keeps the selection inside the shell viewport.
 * The Create Stash and Delete Stash modals are overlay entries; the Pop confirmation is opened by
 * the hook through the shared overlay provider. Nothing here calls git or registers a global
 * action.
 *
 * @returns The stashes panel body.
 */
export function StashesPanel(): ReactNode {
  const tokens = useTokens();
  const stashes = useStashes({
    renderCreateStashModal: useCallback((input) => <CreateStashModal {...input} />, []),
    renderDeleteStashModal: useCallback((input) => <DeleteStashModal {...input} />, []),
  });

  useScrollSelectedRow(
    stashes.selected === null ? null : stashRowId(stashes.selected.objectName),
    stashes.selectedIndex,
  );

  return (
    <box flexDirection="column" flexGrow={1}>
      {stashes.busy ? (
        <text fg={tokens.dim} wrapMode="none">
          {STASHES_BUSY_MESSAGE}
        </text>
      ) : null}
      {stashes.error === null ? null : (
        <ErrorState
          message={STASHES_ERROR_MESSAGE}
          details={stashes.error}
          onRetry={stashes.retry}
        />
      )}
      {stashes.loading ? <LoadingRow label={STASHES_LOADING_LABEL} /> : null}
      {stashes.rows.map((stash, index) => (
        <StashRow
          key={stash.objectName}
          stash={stash}
          selected={index === stashes.selectedIndex}
          focused={stashes.focused}
          onMouseDown={() => {
            stashes.handleRowClick(index);
          }}
        />
      ))}
      {stashes.hiddenCount === 0 ? null : (
        <text fg={tokens.dim} wrapMode="none">
          {`${STASHES_TRUNCATION_LABEL} ${stashes.rows.length} of ${stashes.totalCount} stashes`}
        </text>
      )}
      {stashes.empty ? (
        <EmptyState message={STASHES_EMPTY_MESSAGE} hint={stashes.emptyHint} />
      ) : null}
    </box>
  );
}
