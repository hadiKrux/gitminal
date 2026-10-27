import { useTerminalDimensions } from "@opentui/react";
import type { ReactNode } from "react";
import { useScrollViewportSize } from "@/app/hooks/useScrollViewportSize";
import { parseSearchTerms } from "@/domain/graph/graph.search";
import { CommitRow } from "@/features/graph/CommitRow";
import { CommitSearchInput } from "@/features/graph/CommitSearchInput";
import { GraphStatusFooter, readPageErrorDetails } from "@/features/graph/GraphStatusFooter";
import {
  GRAPH_BOUNDED_MISS_MESSAGE,
  GRAPH_CONTENT_PADDING_X,
  GRAPH_EMPTY_HINT,
  GRAPH_EMPTY_MESSAGE,
  GRAPH_INITIAL_LOADING_LABEL,
  GRAPH_OVERSCAN_ROWS,
  GRAPH_PARENT_LOADING_LABEL,
  GRAPH_RETRY_ID,
  GRAPH_SCROLL_ID,
  GRAPH_SEARCH_ERROR_MESSAGE,
  GRAPH_SEARCH_LOADING_LABEL,
} from "@/features/graph/graph.constants";
import type { VisibleWindow } from "@/features/graph/graph.types";
import {
  computeVisibleWindow,
  readScrollRowDelta,
  readStatusFooterLines,
  readTerminalRowCapacity,
  readViewportRowCapacity,
} from "@/features/graph/graph.window";
import { PendingChangesRow } from "@/features/graph/PendingChangesRow";
import { SearchResultRow } from "@/features/graph/SearchResultRow";
import { useCommitGraph } from "@/features/graph/useCommitGraph";
import { useTokens } from "@/theme/useTokens";
import { EmptyState } from "@/ui/EmptyState";
import { ErrorState } from "@/ui/ErrorState";
import { LoadingRow } from "@/ui/LoadingRow";
import { Panel } from "@/ui/Panel";

/**
 * Renders the complete Commit panel: frame, header, search field, and virtualized row body.
 *
 * The component owns its `Panel` and `<scrollbox viewportCulling>` frame, so the composition root
 * can mount it directly in the main area. Only the visible window plus a small overscan is mounted;
 * the active cursor drives the window, the mounted slice always keeps the cursor inside the measured
 * scrollbox viewport, and appending an older page never moves the selection. The trailing loading,
 * walk-error, page-error, and end-of-history rows sit in a fixed footer below the scrollbox so they
 * stay visible when the loaded window fills the panel, and that footer is bounded so it cannot grow
 * without limit at the minimum width. Search replaces the graph body with a flat result list while
 * the Pending Changes row and lanes are hidden. The scrollbox viewport measures its own content width
 * and height, so every row budgets against the cells it actually gets, excluding the scrollbar, and
 * the row capacity follows the real viewport rather than the terminal. The scrollbox carries one cell
 * of horizontal padding on each side, so the row budget subtracts that padding and the rows never
 * reach the panel border or the scrollbar. Each row starts its text right after its own lane grid,
 * so the tree stays connected and a branch row is indented by its lane count. The terminal height is
 * only the first-frame estimate before layout publishes the viewport. A bounded wheel handler moves
 * the cursor through the mounted window and keeps native scroll from applying twice.
 *
 * @returns The commit graph panel.
 */
export function CommitGraph(): ReactNode {
  const tokens = useTokens();
  const dimensions = useTerminalDimensions();
  const graph = useCommitGraph();
  const { width, height, onSizeChange } = useScrollViewportSize(graph.scrollRef);
  const searchMode = graph.search.isOpen && graph.search.isResultsMode;
  const pageErrorDetails = graph.error === null ? undefined : readPageErrorDetails(graph.error);
  const footerLines = searchMode
    ? 0
    : readStatusFooterLines({
        isLoadingOlder: graph.isLoadingOlder,
        hasWalkError: graph.walkError !== null,
        hasPageError: graph.error !== null,
        hasPageErrorDetails: pageErrorDetails !== undefined,
        isDone: graph.isDone,
      });
  const capacity =
    height > 0
      ? readViewportRowCapacity(height)
      : readTerminalRowCapacity(dimensions.height, footerLines);
  const rowWidth = Math.max(1, width - GRAPH_CONTENT_PADDING_X * 2);
  const itemCount = searchMode ? graph.search.results.length : graph.rows.length;
  const selectedIndex = searchMode ? graph.search.selectedIndex : graph.activeIndex;
  const window = computeVisibleWindow(itemCount, selectedIndex, capacity, GRAPH_OVERSCAN_ROWS);
  const header = readHeader(graph);

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
            {header}
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
          paddingLeft={GRAPH_CONTENT_PADDING_X}
          paddingRight={GRAPH_CONTENT_PADDING_X}
          onMouseScroll={(event) => {
            const scroll = event.scroll;

            if (
              scroll === undefined ||
              (scroll.direction !== "up" && scroll.direction !== "down")
            ) {
              return;
            }

            event.preventDefault();
            graph.scrollBy(readScrollRowDelta(scroll.direction, scroll.delta));
          }}
        >
          {searchMode ? (
            <SearchBody graph={graph} window={window} width={rowWidth} />
          ) : (
            <GraphBody graph={graph} window={window} width={rowWidth} />
          )}
        </scrollbox>
        {searchMode ? null : (
          <GraphStatusFooter
            isLoadingOlder={graph.isLoadingOlder}
            walkError={graph.walkError}
            pageError={graph.error}
            isDone={graph.isDone}
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
 * Every row draws its own lane grid and starts its text right after it, so a branch row is indented
 * by its lane count while a linear row starts after a single lane.
 *
 * @param props - Graph handle, mounted row range, and measured row width.
 * @returns Pending, commit, loading, error, empty, and end-of-history rows.
 */
function GraphBody(props: {
  readonly graph: ReturnType<typeof useCommitGraph>;
  readonly window: VisibleWindow;
  readonly width: number;
}): ReactNode {
  const tokens = useTokens();
  const graph = props.graph;
  const visible = graph.rows.slice(props.window.start, props.window.end);

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
      {visible.map((row, offset) => {
        const index = props.window.start + offset;

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
      {graph.isEmpty ? <EmptyState message={GRAPH_EMPTY_MESSAGE} hint={GRAPH_EMPTY_HINT} /> : null}
    </>
  );
}

/**
 * Renders the flat search result body.
 *
 * @param props - Graph handle carrying search state, the mounted result range, and the measured row
 * width.
 * @returns Search loading, error, empty, and result rows.
 */
function SearchBody(props: {
  readonly graph: ReturnType<typeof useCommitGraph>;
  readonly window: VisibleWindow;
  readonly width: number;
}): ReactNode {
  const graph = props.graph;
  const search = graph.search;
  const visible = search.results.slice(props.window.start, props.window.end);

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
      {visible.map((result, offset) => {
        const index = props.window.start + offset;

        return (
          <SearchResultRow
            key={result.id}
            view={result}
            width={props.width}
            terms={parseSearchTerms(search.query)}
            selected={index === search.selectedIndex}
            focused={graph.region.focused}
            onMouseDown={() => {
              search.handleResultClick(index);
            }}
          />
        );
      })}
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
