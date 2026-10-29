import { useCallback, useEffect, useMemo, useRef } from "react";
import { publishActionAvailability } from "@/app/hooks/useActionAvailability";
import { useFeatureSearch, useFeatureSearchReveal } from "@/app/hooks/useFeatureSearch";
import { useFocusRegion } from "@/app/hooks/useFocusRegion";
import { useListCursor } from "@/app/hooks/useListCursor";
import { useRepository } from "@/app/hooks/useRepository";
import { useStatus } from "@/app/hooks/useStatus";
import { describeCommandReason } from "@/domain/commands/commands.reasons";
import type { CommandAvailability } from "@/domain/commands/commands.types";
import { PUSH_AUTO_CREATE_REMOTE } from "@/domain/git/git.remotes";
import type { TagRowRecord } from "@/domain/git/git.types";
import { selectTagRows } from "@/domain/repository/repository.selectors";
import type { RepositorySnapshot } from "@/domain/repository/repository.types";
import { tagRowId } from "@/features/tags/TagRow";
import { useTagActions } from "@/features/tags/useTagActions";

/** Maximum logical tag rows rendered at once; the rest are reported as truncated. */
const TAG_ROW_RENDER_CAP = 5000;

/**
 * Owns the Tags panel view state and the region-scoped tag actions.
 *
 * Rows come from `selectTagRows`, which merges local and remote tag knowledge and applies the
 * version-aware ordering, so this hook never recomputes scope or order. Navigation and the persisted
 * cursor belong to `useListCursor` with `nav.first`/`nav.last` disabled, because the Tags context
 * does not claim `g` and `G`. The hook registers exactly `tag.create`, `tag.delete`, `tag.push`, and
 * `list.filter` in the `tags` scope; it never registers `nav.*`, `app.refresh`, or `focus.*`.
 *
 * The panel is read-only while another mutation runs, because availability refuses every mutation
 * through the repository reader, and a focus flip refreshes local refs plus remote tag knowledge.
 *
 * @param input - Callbacks that open the create and delete modals owned by `TagsPanel`.
 * @returns Rows, search reveal state, cursor helpers, state flags, and availability helpers.
 */
export function useTags(input: {
  readonly openCreateTag: () => void;
  readonly openDeleteTag: (row: TagRowRecord) => void;
}) {
  const repository = useRepository();
  const { operation, setStatus } = useStatus();
  const { focused } = useFocusRegion("tags");
  const search = useFeatureSearch("tags");
  const list = useTagList(search.revealId);
  const navigation = useTagNavigation(list.rows, list.cursorItems);
  useFeatureSearchReveal(search, list.cursorItems, navigation.selectId, tagRowId);
  const defaultRemote = useMemo(
    () => resolveDefaultRemote(repository.snapshot),
    [repository.snapshot],
  );

  const error = repository.listFailures.tags ?? repository.lastRefreshError;
  const createAvailability = readCreateAvailability(repository);
  const deleteAvailability = readRowAvailability(repository, "tag.delete", navigation.activeRow);
  const pushAvailability = readRowAvailability(repository, "tag.push", navigation.activeRow);

  usePublishedAvailability("tag.create", createAvailability.available);
  usePublishedAvailability("tag.delete", deleteAvailability.available);
  usePublishedAvailability("tag.push", pushAvailability.available);

  useTagFocusRefresh(focused);

  const actions = useTagActions({
    activeRow: navigation.activeRow,
    rows: list.rows,
    defaultRemote,
    openCreateTag: input.openCreateTag,
    openDeleteTag: input.openDeleteTag,
    setStatus,
  });

  return {
    rows: list.rows,
    totalCount: list.totalCount,
    filteredCount: list.filteredCount,
    truncatedCount: list.truncatedCount,
    focused,
    loading:
      repository.snapshot === null && repository.state.primary === "loading" && error === null,
    error,
    busy: operation !== null,
    activeIndex: navigation.activeIndex,
    activeRow: navigation.activeRow,
    selectRow: navigation.selectRow,
    handleRowClick: navigation.handleRowClick,
    defaultRemote,
    createAvailability,
    pushAvailability: actions.readPushAvailability,
    retry: createRetryAction(repository.refreshStatus),
  };
}

/**
 * Publishes one tag action's availability for the current selected row.
 *
 * The footer, help, and palette read the registry instead of importing the feature, so `tag.push`
 * disappears for a tag already known on the remote and `tag.delete` disappears without a target.
 * The effect removes its exact publication when the target or availability changes.
 *
 * @param actionId - Tag action id.
 * @param available - True when the action can run for the selected target.
 */
function usePublishedAvailability(actionId: string, available: boolean): void {
  useEffect(() => publishActionAvailability("tags", actionId, available), [actionId, available]);
}

/**
 * Reads the availability of one row-scoped tag action.
 *
 * A missing active row is unavailable with the shared missing-target reason, so the footer never
 * advertises a delete or push with nothing selected.
 *
 * @param repository - Current repository context.
 * @param commandId - Tag delete or push.
 * @param row - Active merged row, or null when the list has none.
 * @returns The target-aware availability result.
 */
function readRowAvailability(
  repository: ReturnType<typeof useRepository>,
  commandId: "tag.delete" | "tag.push",
  row: TagRowRecord | null,
): CommandAvailability {
  if (row === null) {
    return { available: false, reason: "missing-target" };
  }

  return repository.getAvailability(commandId, { kind: "tag", name: row.name }, "tags");
}

/**
 * Owns the capped selector-derived tag rows.
 *
 * @param revealId - Accepted search identity used to extend the visible prefix beyond its soft cap.
 * @returns The row ledger counts, visible rows, and cursor items.
 */
function useTagList(revealId: string | null) {
  const repository = useRepository();
  const rows = useMemo(
    () => selectTagRows(repository.snapshot, repository.remoteTagChecks),
    [repository.snapshot, repository.remoteTagChecks],
  );
  const visibleRows = useMemo(
    () =>
      rows.slice(
        0,
        Math.max(TAG_ROW_RENDER_CAP, rows.findIndex((row) => row.name === revealId) + 1),
      ),
    [rows, revealId],
  );
  const cursorItems = useMemo(() => visibleRows.map((row) => ({ id: row.name })), [visibleRows]);

  return {
    rows: visibleRows,
    totalCount: rows.length,
    filteredCount: rows.length,
    truncatedCount: Math.max(0, rows.length - visibleRows.length),
    cursorItems,
  };
}

/**
 * Owns the tags cursor, row selection, and commit activation.
 *
 * `nav.activate` selects the peeled commit of the active local tag in the right pane, which is the
 * internal `graph.selectCommit` semantics. A remote-only row has no local commit, so activation
 * leaves the selection untouched and no git call is made.
 *
 * @param rows - Visible rows in render order.
 * @param cursorItems - Stable row identities for the persisted cursor.
 * @returns The active index and row plus the cursor click helpers.
 */
function useTagNavigation(
  rows: readonly TagRowRecord[],
  cursorItems: readonly { readonly id: string }[],
) {
  const repository = useRepository();
  const rowsRef = useRef(rows);
  const indexRef = useRef(0);

  rowsRef.current = rows;

  /**
   * Applies the graph selection semantics to one merged tag row.
   *
   * @param row - Row to activate, or undefined when the index is outside the list.
   */
  const activateRowAt = useCallback(
    (row: TagRowRecord | undefined): void => {
      if (row === undefined || !row.local || row.targetOid.length === 0) {
        return;
      }

      repository.setSelection({ kind: "commit", oid: row.targetOid });
    },
    [repository],
  );

  /** Selects the tagged commit of the active row in the graph, without a git call. */
  const activateRow = useCallback((): void => {
    activateRowAt(rowsRef.current[indexRef.current]);
  }, [activateRowAt]);

  /**
   * Selects the tagged commit of one clicked row in the graph, without a git call.
   *
   * @param index - Row index reported by the click that completed the double click.
   */
  const activateAtIndex = useCallback(
    (index: number): void => {
      activateRowAt(rowsRef.current[index]);
    },
    [activateRowAt],
  );

  const cursor = useListCursor({
    regionId: "tags",
    items: cursorItems,
    onActivate: activateRow,
    onDoubleClick: activateAtIndex,
    enableFirstLast: false,
  });

  indexRef.current = cursor.index;

  return {
    activeIndex: cursor.index,
    activeRow: rows[cursor.index] ?? null,
    selectRow: cursor.select,
    selectId: cursor.selectId,
    handleRowClick: cursor.handleRowClick,
  };
}

/**
 * Refreshes local refs and remote tag knowledge when the Tags region gains focus.
 *
 * The refresh runs only on the false-to-true transition, so a focus that stays inside a descendant
 * input never repeats the network read and no timer or poll is introduced.
 *
 * @param focused - True while the tags region or a descendant owns native focus.
 */
function useTagFocusRefresh(focused: boolean): void {
  const repository = useRepository();
  const previousFocusedRef = useRef(false);
  const { refreshRemoteTags, refreshStatus } = repository;

  useEffect(() => {
    const wasFocused = previousFocusedRef.current;

    previousFocusedRef.current = focused;

    if (!focused || wasFocused) {
      return;
    }

    void refreshStatus();
    void refreshRemoteTags();
  }, [focused, refreshRemoteTags, refreshStatus]);
}

/**
 * Reads the display availability of `tag.create` for the panel header and tests.
 *
 * @param repository - Current repository context.
 * @returns Whether a tag can be created and the display text of its blocking reason.
 */
function readCreateAvailability(repository: ReturnType<typeof useRepository>): {
  readonly available: boolean;
  readonly reason: string | null;
} {
  const availability = repository.getAvailability("tag.create", { kind: "none" }, "tags");

  if (availability.available) {
    return { available: true, reason: null };
  }

  return {
    available: false,
    reason: describeCommandReason(availability.reason ?? "command-not-implemented"),
  };
}

/**
 * Builds the panel Retry handler.
 *
 * @param refreshStatus - Repository status refresh owned by the provider.
 * @returns A callback that starts one silent read.
 */
function createRetryAction(
  refreshStatus: ReturnType<typeof useRepository>["refreshStatus"],
): () => void {
  return () => {
    void refreshStatus();
  };
}

/**
 * Reads the remote a create-and-push or push action targets.
 *
 * The configured upstream remote of the current branch wins, then `origin`, then the first
 * configured remote. A remote name is never split from the upstream display ref, because a legal
 * remote name may contain a slash.
 *
 * @param snapshot - Current snapshot, or null before the first read.
 * @returns The remote name, or an empty string when no remote is configured.
 */
export function resolveDefaultRemote(snapshot: RepositorySnapshot | null): string {
  const remotes = snapshot?.remotes ?? [];
  const currentBranch = snapshot?.branches.find((branch) => branch.head) ?? null;
  const upstreamRemote = currentBranch?.upstreamRemote ?? null;

  if (upstreamRemote !== null && remotes.some((remote) => remote.name === upstreamRemote)) {
    return upstreamRemote;
  }

  if (remotes.some((remote) => remote.name === PUSH_AUTO_CREATE_REMOTE)) {
    return PUSH_AUTO_CREATE_REMOTE;
  }

  return remotes[0]?.name ?? "";
}
