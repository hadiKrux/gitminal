import { type ReactNode, useCallback } from "react";
import { useOverlay } from "@/app/hooks/useOverlay";
import { useScrollSelectedRow } from "@/app/hooks/useScrollSelectedRow";
import type { TagRowRecord } from "@/domain/git/git.types";
import { CreateTagModal } from "@/features/tags/CreateTagModal";
import { CREATE_TAG_NAME_INPUT_ID } from "@/features/tags/CreateTagModal.constants";
import { DeleteTagModal } from "@/features/tags/DeleteTagModal";
import { DELETE_TAG_SCOPE_SELECT_ID } from "@/features/tags/DeleteTagModal.constants";
import { TagRow, tagRowId } from "@/features/tags/TagRow";
import {
  CREATE_TAG_OVERLAY_ID,
  DELETE_TAG_OVERLAY_ID_PREFIX,
  TAGS_BUSY_MESSAGE,
  TAGS_EMPTY_HINT,
  TAGS_EMPTY_MESSAGE,
  TAGS_ERROR_MESSAGE,
  TAGS_LOADING_LABEL,
  TAGS_TRUNCATION_LABEL,
} from "@/features/tags/TagsPanel.constants";
import { useTags } from "@/features/tags/useTags";
import { useTokens } from "@/theme/useTokens";
import { EmptyState } from "@/ui/EmptyState";
import { ErrorState } from "@/ui/ErrorState";
import { LoadingRow } from "@/ui/LoadingRow";

/**
 * Renders the Tags panel body.
 *
 * The shell already supplies the focusable panel frame, the border title with the count, and the
 * scroll container, so this component returns only the tag rows, and the state
 * rows. Rows come from `useTags`, which reads `selectTagRows` and orders them version-descending.
 * The panel never recomputes scope or order, never calls git, and never registers a global action.
 * The active row id is passed to `useScrollSelectedRow`, so keyboard navigation keeps the selection
 * inside the shell viewport.
 *
 * The Create Tag modal and the Delete Tag modal are overlay entries rendered by the overlay host.
 * The push confirmation is opened by `useTags` through the shared overlay provider.
 *
 * @returns The tags panel body.
 */
export function TagsPanel(): ReactNode {
  const tokens = useTokens();
  const overlay = useOverlay();
  const tags = useTags({
    openCreateTag: useCallback(() => {
      overlay.open({
        kind: "modal",
        id: CREATE_TAG_OVERLAY_ID,
        initialFocusId: CREATE_TAG_NAME_INPUT_ID,
        render: ({ close }) => <CreateTagModal onClose={close} />,
      });
    }, [overlay]),
    openDeleteTag: useCallback(
      (row: TagRowRecord) => {
        overlay.open({
          kind: "modal",
          id: `${DELETE_TAG_OVERLAY_ID_PREFIX}${row.name}`,
          initialFocusId: DELETE_TAG_SCOPE_SELECT_ID,
          render: ({ close }) => <DeleteTagModal row={row} onClose={close} />,
        });
      },
      [overlay],
    ),
  });
  const showEmpty = !tags.loading && tags.error === null && tags.totalCount === 0;

  useScrollSelectedRow(
    tags.activeRow === null ? null : tagRowId(tags.activeRow.name),
    tags.activeIndex,
  );

  return (
    <box flexDirection="column" flexGrow={1}>
      {tags.busy ? (
        <text fg={tokens.dim} wrapMode="none">
          {TAGS_BUSY_MESSAGE}
        </text>
      ) : null}
      {tags.error === null ? null : (
        <ErrorState message={TAGS_ERROR_MESSAGE} details={tags.error} onRetry={tags.retry} />
      )}
      {tags.loading ? <LoadingRow label={TAGS_LOADING_LABEL} /> : null}
      {tags.rows.map((row, index) => (
        <TagRow
          key={row.name}
          row={row}
          selected={index === tags.activeIndex}
          focused={tags.focused}
          onPress={() => {
            tags.handleRowClick(index);
          }}
        />
      ))}
      {tags.truncatedCount === 0 ? null : (
        <text fg={tokens.dim} wrapMode="none">
          {`${TAGS_TRUNCATION_LABEL} ${tags.rows.length} of ${tags.filteredCount} tags`}
        </text>
      )}
      {showEmpty ? <EmptyState message={TAGS_EMPTY_MESSAGE} hint={TAGS_EMPTY_HINT} /> : null}
    </box>
  );
}
