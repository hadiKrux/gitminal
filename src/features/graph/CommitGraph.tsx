import type { ReactNode } from "react";
import { useScrollViewportSize } from "@/app/hooks/useScrollViewportSize";
import { parseSearchTerms } from "@/domain/graph/graph.search";
import { CommitRow } from "@/features/graph/CommitRow";
import { CommitSearchInput } from "@/features/graph/CommitSearchInput";
import { GraphStatusFooter } from "@/features/graph/GraphStatusFooter";
import {
  GRAPH_BOUNDED_MISS_MESSAGE,
  GRAPH_CONTENT_PADDING_X,
  GRAPH_EMPTY_HINT,
  GRAPH_EMPTY_MESSAGE,
  GRAPH_INITIAL_LOADING_LABEL,
  GRAPH_LOAD_OLDER_ID,
  GRAPH_LOAD_OLDER_LABEL,
  GRAPH_PARENT_LOADING_LABEL,
  GRAPH_RETRY_ID,
  GRAPH_SCROLL_ID,
  GRAPH_SCROLLBAR_WIDTH,
  GRAPH_SEARCH_ERROR_MESSAGE,
  GRAPH_SEARCH_LOADING_LABEL,
} from "@/features/graph/graph.constants";
import { readGraphRevealTarget, readSearchRevealTarget } from "@/features/graph/graph.rows";
import { PendingChangesRow } from "@/features/graph/PendingChangesRow";
import { SearchResultRow } from "@/features/graph/SearchResultRow";
import { useCommitGraph } from "@/features/graph/useCommitGraph";
import { useGraphReveal } from "@/features/graph/useGraphReveal";
import { truncateText } from "@/lib/text";
import { useTokens } from "@/theme/useTokens";
import { Button } from "@/ui/Button";
import { BUTTON_HORIZONTAL_PADDING } from "@/ui/Button.constants";
import { EmptyState } from "@/ui/EmptyState";
import { ErrorState } from "@/ui/ErrorState";
import { LoadingRow } from "@/ui/LoadingRow";
import { Panel } from "@/ui/Panel";

/**
 * Renders the complete Commit panel: frame, header, search field, and row body.
 *
 * The component owns its `Panel` and `<scrollbox viewportCulling>` frame, so the composition root
 * can mount it directly in the main area. Every loaded row is mounted with its stable renderable id,
 * exactly like the diff panel, so the native scrollbar and scroll offset describe the whole loaded
 * page window; that window is already bounded by the paginator, so there is no second mounted slice.
 * `useGraphReveal` reveals the selected graph row, or the selected search result, through the
 * scrollbox's own `scrollChildIntoView`, which is the same reveal path the diff panel uses. The
 * trailing loading, walk-error, and page-error rows stay in the fixed footer below the scrollbox, so
 * they remain visible when the loaded rows fill the panel. The reveal also runs when the measured
 * viewport height changes and the selected row was visible before the change, so a growing footer
 * cannot clip the selected row without pulling a freely scrolled viewport back.
 *
 * Search replaces the graph body with a flat result list while the Pending Changes row and lanes are
 * hidden, and its result cursor is revealed through the same scrollbox. The scrollbox keeps its
 * vertical scrollbar, reserves one column for it, and disables horizontal scrolling because every row
 * is width-budgeted from the measured viewport. It carries one cell of horizontal padding on each
 * side, so the row budget subtracts that padding and no row reaches the panel border or the
 * scrollbar. Each row starts its text right after its own lane grid, so the tree stays connected and
 * a branch row is indented by its lane count. Mouse wheel and trackpad scrolling use OpenTUI's
 * native viewport scrolling and never move the selection, matching the diff and sidebar lists. The
 * last loaded row is followed by a Load older commits button when another page exists; the same
 * read is bound to the graph `graph.loadOlder` action, so history is never paged automatically by
 * scrolling or by moving the cursor near the end. The button unmounts while a page is in flight and
 * the fixed footer carries the loading marker instead, so the load control never appears twice.
 *
 * @returns The commit graph panel.
 */
export function CommitGraph(): ReactNode {
  const tokens = useTokens();
  const graph = useCommitGraph();
  const { width, height, onSizeChange } = useScrollViewportSize(graph.scrollRef);
  const searchMode = graph.search.isOpen && graph.search.isResultsMode;
  const rowWidth = Math.max(1, width - GRAPH_CONTENT_PADDING_X * 2);
  const reveal = searchMode
    ? readSearchRevealTarget(graph.search.results, graph.search.selectedIndex)
    : readGraphRevealTarget(graph.rows, graph.selectedRowId);

  useGraphReveal({
    scrollRef: graph.scrollRef,
    target: reveal,
    bodyKey: searchMode ? "search" : "graph",
    viewportHeight: height,
    firstRowId: searchMode ? null : (graph.rows[0]?.id ?? null),
  });

  return (
    <Panel
      {...graph.region.regionProps}
      focused={graph.region.focused}
      title="Commits"
      flexGrow={1}
      flexBasis={0}
      minWidth={16}
      minHeight={4}
    >
      <box flexDirection="column" flexGrow={1} minHeight={0}>
        <box flexDirection="row" flexShrink={0} height={1} paddingLeft={1}>
          <text fg={tokens.muted} wrapMode="none" flexShrink={1}>
            {readHeader(graph)}
          </text>
          {graph.search.statusText === null ? null : (
            <text fg={tokens.accent} wrapMode="none" flexShrink={1}>
              {` | ${graph.search.statusText}`}
            </text>
          )}
        </box>
        {graph.search.isOpen ? (
          <CommitSearchInput
            value={graph.search.query}
            onInput={graph.search.setQuery}
            onSubmit={graph.search.submit}
            disabled={graph.search.isUnavailable}
          />
        ) : null}
        <scrollbox
          ref={graph.scrollRef}
          id={GRAPH_SCROLL_ID}
          onSizeChange={onSizeChange}
          flexGrow={1}
          flexShrink={1}
          focusable={false}
          viewportCulling
          scrollY
          scrollX={false}
          paddingLeft={GRAPH_CONTENT_PADDING_X}
          paddingRight={GRAPH_CONTENT_PADDING_X}
          scrollbarOptions={{ trackOptions: { foregroundColor: tokens.scrollbar } }}
          // The explicit one-column width reserves the scrollbar column inside the panel frame, the
          // same way the diff panel does.
          verticalScrollbarOptions={{ width: GRAPH_SCROLLBAR_WIDTH }}
          // Graph rows are width-budgeted to the viewport, so there is nothing to scroll horizontally.
          horizontalScrollbarOptions={{ visible: false }}
        >
          <box flexDirection="column" flexShrink={0}>
            {searchMode ? (
              <SearchBody graph={graph} width={rowWidth} />
            ) : (
              <GraphBody graph={graph} width={rowWidth} />
            )}
          </box>
        </scrollbox>
        {searchMode ? null : (
          <GraphStatusFooter
            isLoadingOlder={graph.isLoadingOlder}
            walkError={graph.walkError}
            pageError={graph.error}
            width={width}
            onRetry={graph.retry}
            onWalkRetry={graph.retryWalk}
          />
        )}
      </box>
    </Panel>
  );
}

/**
 * Renders the normal graph body.
 *
 * Every loaded row is mounted, in display order: the Pending Changes row, then the commits. Each row
 * draws its own lane grid and starts its text right after it, so a branch row is indented by its lane
 * count while a linear row starts after a single lane.
 *
 * @param props - Graph handle and the measured row width.
 * @returns Pending, commit, loading, error, empty, and bounded-miss rows.
 */
function GraphBody(props: {
  readonly graph: ReturnType<typeof useCommitGraph>;
  readonly width: number;
}): ReactNode {
  const tokens = useTokens();
  const graph = props.graph;

  return (
    <>
      {graph.isLoadingInitial ? <LoadingRow label={GRAPH_INITIAL_LOADING_LABEL} /> : null}
      {graph.isLoadingParent ? <LoadingRow label={GRAPH_PARENT_LOADING_LABEL} /> : null}
      {graph.boundedMiss ? (
        <box flexDirection="row" flexShrink={0} paddingLeft={1}>
          <text fg={tokens.warning} wrapMode="word">
            {GRAPH_BOUNDED_MISS_MESSAGE}
          </text>
        </box>
      ) : null}
      {graph.rows.map((row, index) => {
        if (row.kind === "pending") {
          return (
            <PendingChangesRow
              key={row.id}
              unstagedCount={row.unstagedCount}
              connected={graph.loadedCount > 0}
              selected={graph.selectedRowId === row.id}
              focused={graph.region.focused}
              onMouseDown={() => {
                graph.handleRowClick(index);
              }}
            />
          );
        }

        return (
          <CommitRow
            key={row.id}
            view={row}
            width={props.width}
            selected={graph.selectedRowId === row.id}
            focused={graph.region.focused}
            onMouseDown={() => {
              graph.handleRowClick(index);
            }}
          />
        );
      })}
      {graph.canLoadOlder ? (
        <box flexDirection="row" flexShrink={0} paddingLeft={1}>
          <Button
            id={GRAPH_LOAD_OLDER_ID}
            label={truncateText(
              GRAPH_LOAD_OLDER_LABEL,
              Math.max(1, props.width - 1 - BUTTON_HORIZONTAL_PADDING * 2),
            )}
            onPress={graph.loadOlder}
          />
        </box>
      ) : null}
      {graph.isEmpty ? <EmptyState message={GRAPH_EMPTY_MESSAGE} hint={GRAPH_EMPTY_HINT} /> : null}
    </>
  );
}

/**
 * Renders the flat search result body.
 *
 * Every loaded result page is mounted, so the same scrollbar and reveal path as the graph body apply
 * to the search result cursor.
 *
 * @param props - Graph handle carrying search state and the measured row width.
 * @returns Search loading, error, empty, and result rows.
 */
function SearchBody(props: {
  readonly graph: ReturnType<typeof useCommitGraph>;
  readonly width: number;
}): ReactNode {
  const graph = props.graph;
  const search = graph.search;
  const terms = parseSearchTerms(search.query);

  return (
    <>
      {search.error === null ? null : (
        <ErrorState
          message={GRAPH_SEARCH_ERROR_MESSAGE}
          details={search.error}
          onRetry={search.retry}
          retryId={`${GRAPH_RETRY_ID}-search`}
        />
      )}
      {search.isLoading && search.results.length === 0 ? (
        <LoadingRow label={GRAPH_SEARCH_LOADING_LABEL} />
      ) : null}
      {search.emptyMessage === null ? null : <EmptyState message={search.emptyMessage} />}
      {search.results.map((result, index) => (
        <SearchResultRow
          key={result.id}
          view={result}
          width={props.width}
          terms={terms}
          selected={index === search.selectedIndex}
          focused={graph.region.focused}
          onMouseDown={() => {
            search.handleResultClick(index);
          }}
        />
      ))}
      {search.isLoading && search.results.length > 0 ? (
        <LoadingRow label={GRAPH_SEARCH_LOADING_LABEL} />
      ) : null}
    </>
  );
}

/**
 * Builds the graph header text.
 *
 * @param graph - Graph handle.
 * @returns Scope, loaded count, and completion marker.
 */
function readHeader(graph: ReturnType<typeof useCommitGraph>): string {
  const count = graph.loadedCount;

  return `${graph.scopeLabel} | ${count}${graph.isDone ? "" : "+"} commits`;
}
