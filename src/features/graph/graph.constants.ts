import type { GraphScope } from "@/domain/config/config.types";
import type { GraphLaneCell } from "@/domain/graph/graph.types";

/** Region id owned by the Commit graph. */
export const GRAPH_REGION_ID = "graph";

/** Stable row identity of the always-first Pending Changes row. */
export const GRAPH_PENDING_ROW_ID = "pending";

/** Stable renderable id of the graph scrollbox, used by tests to inspect native scroll. */
export const GRAPH_SCROLL_ID = "graph-scroll";

/** Stable renderable id of the commit search input. */
export const GRAPH_SEARCH_INPUT_ID = "graph-search";

/** Quiet interval before a typed commit query is dispatched. */
export const GRAPH_SEARCH_DEBOUNCE_MS = 180;

/** Rows mounted beyond each edge of the visible window. */
export const GRAPH_OVERSCAN_ROWS = 4;

/** Cells of horizontal padding inside the graph scrollbox on each side. */
export const GRAPH_CONTENT_PADDING_X = 1;

/** Cells one graph lane occupies: the glyph plus its horizontal connector. */
export const GRAPH_LANE_CELL_WIDTH = 2;

/** Cell of the Pending Changes node: a commit symbol above the newest commit. */
export const GRAPH_PENDING_NODE_CELL: GraphLaneCell = Object.freeze({
  up: false,
  down: true,
  left: false,
  right: false,
  kind: "commit",
  lane: 0,
});

/** Cell that carries the Pending Changes node down into the newest commit. */
export const GRAPH_PENDING_LINE_CELL: GraphLaneCell = Object.freeze({
  up: true,
  down: true,
  left: false,
  right: false,
  kind: "line",
  lane: 0,
});

/** Rows from the bottom that trigger an older-page load. */
export const GRAPH_NEAR_BOTTOM_ROWS = 6;

/** Lines each graph row occupies: subject and metadata. */
export const GRAPH_ROW_HEIGHT = 2;

/** Panel chrome above and below the row body: title border, header, and footer border. */
export const GRAPH_CHROME_ROWS = 4;

/** Gap between two clicks that still counts as a double click. */
export const GRAPH_DOUBLE_CLICK_MS = 400;

/** Character budget for one search-result body snippet. */
export const GRAPH_SNIPPET_BUDGET = 72;

/** Short commit hash length shown in search results. */
export const GRAPH_SHORT_OID_LENGTH = 7;

/** Ref names longer than this many characters keep the status readable by truncation. */
export const GRAPH_MAX_BADGE_LENGTH = 24;

/** Text shown while the first page is loading. */
export const GRAPH_INITIAL_LOADING_LABEL = "Loading history...";

/** Text shown while an older page is loading. */
export const GRAPH_OLDER_LOADING_LABEL = "Loading older commits...";

/** Text shown while a parent or search-selected commit is loading. */
export const GRAPH_PARENT_LOADING_LABEL = "Loading parent commit...";

/** Text shown when a commit is outside the bounded loaded history. */
export const GRAPH_BOUNDED_MISS_MESSAGE = "Commit is not within the loaded history";

/** Text shown when history is exhausted. */
export const GRAPH_END_OF_HISTORY_MESSAGE = "Beginning of history";

/** Text shown for a repository with no commits. */
export const GRAPH_EMPTY_MESSAGE = "No commits yet";

/** Hint shown under the empty state. */
export const GRAPH_EMPTY_HINT = "Stage files below to make the first commit";

/** Text shown when the repository cannot be read. */
export const GRAPH_LOAD_ERROR_MESSAGE = "Unable to read commit history";

/** Text shown when a bounded parent or search-result walk fails a page read. */
export const GRAPH_WALK_ERROR_MESSAGE = "Unable to load the selected commit";

/** Text shown when commit search is unavailable. */
export const GRAPH_SEARCH_UNAVAILABLE_MESSAGE = "No commits to search";

/** Text shown while a query is in flight. */
export const GRAPH_SEARCHING_MESSAGE = "Searching...";

/** Text shown when a query fails. */
export const GRAPH_SEARCH_ERROR_MESSAGE = "Commit search failed";

/** Placeholder of the commit search field. */
export const GRAPH_SEARCH_PLACEHOLDER = "Search commit messages...";

/** Loading label for a search result page. */
export const GRAPH_SEARCH_LOADING_LABEL = "Loading matching commits...";

/** Rows moved by PageUp and PageDown in the flat search result list. */
export const GRAPH_SEARCH_PAGE_STEP = 10;

/** Quiet interval before a wheel-driven commit selection is dispatched. */
export const GRAPH_SELECTION_DEBOUNCE_MS = 180;

/** Rows one mouse-wheel notch moves the graph cursor. */
export const GRAPH_SCROLL_STEP_ROWS = 3;

/** Largest number of wheel notches applied from one mouse event. */
export const GRAPH_SCROLL_MAX_STEPS = 3;

/** Stable renderable id of the Pending Changes row. */
export const GRAPH_PENDING_ROW_RENDERABLE_ID = "graph-row:pending";

/** Left indent in cells for one graph footer row. */
export const GRAPH_FOOTER_ROW_INDENT = 1;

/** Gap in cells between footer text and its action button. */
export const GRAPH_FOOTER_ROW_GAP = 1;

/** Visible label of the graph Retry actions. */
export const GRAPH_RETRY_LABEL = "Retry";

/** Retry button id used by the page and search error rows. */
export const GRAPH_RETRY_ID = "graph-retry";

/** Retry button id used by the walk-error row, distinct from the page Retry. */
export const GRAPH_WALK_RETRY_ID = "graph-walk-retry";

/** Label of the always-first Pending Changes row. */
export const GRAPH_PENDING_LABEL = "Commit Changes";

/** Text shown for a clean working tree on the Pending Changes row. */
export const GRAPH_CLEAN_TREE_MESSAGE = "Working tree clean";

/** Display label of each graph scope. */
export const GRAPH_SCOPE_LABELS: Readonly<Record<GraphScope, string>> = Object.freeze({
  all: "all refs",
  local: "local branches",
  current: "HEAD",
});
