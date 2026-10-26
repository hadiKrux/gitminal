import type { ScrollBoxRenderable } from "@opentui/core";
import type { MutableRefObject, RefObject } from "react";
import type { useFocusRegion } from "@/app/hooks/useFocusRegion";
import type { GraphScope } from "@/domain/config/config.types";
import type { GitClient } from "@/domain/git/git.types";
import type {
  EnsureLoadedResult,
  GraphCommit,
  GraphPaginator,
  GraphRow,
} from "@/domain/graph/graph.types";
import type { RepositorySelection } from "@/domain/repository/repository.types";

/** Structural focus handle the graph renders without importing another feature. */
type FocusRegionHandle = ReturnType<typeof useFocusRegion>;

/** One classified ref badge. */
export interface GraphRefBadge {
  /** Display label without decoration prefixes. */
  readonly label: string;
  /** Badge group that decides token and ordering. */
  readonly kind: "tag" | "local" | "remote";
}

/** Ref badges split into the documented tag, local, and remote groups. */
export interface GraphRefGroups {
  /** Tags first. */
  readonly tags: readonly string[];
  /** Local branches second. */
  readonly local: readonly string[];
  /** Remote-tracking branches last. */
  readonly remote: readonly string[];
}

/** Theme colors a graph ref badge can use. */
export interface GraphBadgeTokens {
  /** Tag badge color. */
  readonly tag: string;
  /** Local branch badge color. */
  readonly branchLocal: string;
  /** Remote branch badge color. */
  readonly branchRemote: string;
}

/** Rendered badge window after the width budget is applied. */
export interface FittedRefBadges {
  /** Badges that fit in the budget. */
  readonly visible: readonly GraphRefBadge[];
  /** Number of badges omitted from the visible window. */
  readonly overflow: number;
}

/** One loaded commit prepared for rendering. */
export interface CommitRowView {
  /** Row kind marker. */
  readonly kind: "commit";
  /** Stable identity, the commit OID. */
  readonly id: string;
  /** Parsed commit row. */
  readonly row: GraphRow;
  /** Lane cells for this row, computed once per page. */
  readonly lanes: readonly string[];
  /** Column of the commit node inside the lane cells. */
  readonly nodeColumn: number;
}

/** The always-first Pending Changes row. */
export interface PendingRowView {
  /** Row kind marker. */
  readonly kind: "pending";
  /** Stable identity. */
  readonly id: "pending";
  /** Number of unstaged tracked changes plus untracked entries. */
  readonly unstagedCount: number;
}

/** One row rendered by the normal graph body. */
export type GraphDisplayRow = PendingRowView | CommitRowView;

/** Explicit right-pane selection a graph row can dispatch. */
export type GraphSelectionTarget =
  | { readonly kind: "pending" }
  | { readonly kind: "commit"; readonly oid: string };

/** One contiguous, non-matching run of searchable text. */
export interface HighlightSegment {
  /** Text of the run. */
  readonly text: string;
  /** True when a query term matched this run. */
  readonly matched: boolean;
}

/** One context snippet around the first body match. */
export interface BodySnippet {
  /** Normalized snippet text. */
  readonly text: string;
  /** True when text was removed before the snippet. */
  readonly leadingEllipsis: boolean;
  /** True when text was removed after the snippet. */
  readonly trailingEllipsis: boolean;
}

/** Search state captured when the input opens, restored by one Esc. */
export interface SearchSnapshot {
  /** Provider selection before search. */
  readonly selection: UseCommitSearchInput["selection"];
  /** Graph cursor before search. */
  readonly cursorId: string | null;
  /** Scroll offset before search. */
  readonly scrollTop: number;
  /** Provider generation when search opened. */
  readonly generation: number;
}

/** Raw engine rows and the exhausted flag held while a query runs. */
export interface SearchResultState {
  /** Raw engine rows. */
  readonly rows: readonly GraphCommit[];
  /** True when no more matches exist. */
  readonly done: boolean;
}

/** One prepared search result. */
export interface SearchResultView {
  /** Stable identity, the commit OID. */
  readonly id: string;
  /** Parsed commit row. */
  readonly row: GraphRow;
  /** Body snippet when the match is in the body, otherwise null. */
  readonly snippet: BodySnippet | null;
}

/** One failed commit walk that is not a page-load failure of the visible window. */
export interface GraphWalkError {
  /** Distinct one-line notice text, never the page-load message. */
  readonly message: string;
  /** True when the walk Retry should re-run the failed window reload that owned this walk. */
  readonly retryable: boolean;
}

/** Half-open row range mounted for one render. */
export interface VisibleWindow {
  /** First mounted row index. */
  readonly start: number;
  /** Exclusive end index. */
  readonly end: number;
}

/** Inputs accepted by `useCommitSearch`. */
export interface UseCommitSearchInput {
  /** Configured graph scope key. */
  readonly scopeKey: GraphScope;
  /** Bounded result page size. */
  readonly pageSize: number;
  /** Git client bound to the configured executable. */
  readonly client: GitClient;
  /** Working directory of the repository. */
  readonly cwd: string;
  /** True when the repository has commits to search. */
  readonly enabled: boolean;
  /** True while the graph region or a descendant owns focus. */
  readonly graphFocused: boolean;
  /** Provider generation captured at open and compared on later renders. */
  readonly generation: number;
  /** Current right-pane selection. */
  readonly selection: RepositorySelection;
  /** Replaces the right-pane selection. */
  readonly setSelection: (selection: RepositorySelection) => void;
  /** Loads the commit and selects it when it is inside the bounded history. */
  readonly selectCommit: (oid: string) => Promise<EnsureLoadedResult>;
  /** Focuses the graph region frame. */
  readonly focusGraph: () => void;
  /** Reads the persisted graph cursor id. */
  readonly readCursor: () => string | null;
  /** Writes or clears the persisted graph cursor id. */
  readonly writeCursor: (id: string | null) => void;
  /** Scroll box that owns the graph viewport. */
  readonly scrollRef: RefObject<ScrollBoxRenderable | null>;
  /** Shows or clears the bounded-miss row. */
  readonly setBoundedMiss: (visible: boolean) => void;
  /** Shows or clears the failed commit walk notice. */
  readonly setWalkError: (error: GraphWalkError | null) => void;
}

/** Search view and the delegates the graph registration calls. */
export interface CommitSearchHandle {
  /** True while the search input is open. */
  readonly isOpen: boolean;
  /** True when a non-empty query replaced the graph body. */
  readonly isResultsMode: boolean;
  /** True when the repository has no commits to search. */
  readonly isUnavailable: boolean;
  /** Raw query value. */
  readonly query: string;
  /** Replaces the raw query. */
  readonly setQuery: (value: string) => void;
  /** Prepared results in display order. */
  readonly results: readonly SearchResultView[];
  /** Selected result index. */
  readonly selectedIndex: number;
  /** Header status text such as `3+ matches`. */
  readonly statusText: string | null;
  /** True while a result page is in flight. */
  readonly isLoading: boolean;
  /** Search failure message, or null. */
  readonly error: string | null;
  /** True when the results are exhausted. */
  readonly done: boolean;
  /** Message shown when a non-empty query has no results. */
  readonly emptyMessage: string | null;
  /** Opens the input, snapshots the graph state, and focuses the field. */
  readonly open: () => void;
  /** Cancels, clears the query, restores the snapshot, and focuses the graph. */
  readonly cancelAndRestore: () => void;
  /** Confirms the selected result. */
  readonly submit: () => void;
  /** Retries the current query. */
  readonly retry: () => void;
  /** Handles a click on one result row and confirms a double click. */
  readonly handleResultClick: (index: number) => void;
  /** Moves the result cursor by one page. */
  readonly pageBy: (direction: "up" | "down") => void;
  /** Moves the result cursor by a bounded row delta for one mouse-wheel event. */
  readonly scrollBy: (delta: number) => void;
  /**
   * Handles one list navigation action while search owns the cursor.
   *
   * @param action - Navigation action to handle.
   * @returns True when search handled the action.
   */
  readonly delegateAction: (action: "up" | "down" | "first" | "last" | "activate") => boolean;
}

/** Graph view state returned by `useCommitGraph`. */
export interface CommitGraphHandle {
  /** Focus handle of the `graph` region. */
  readonly region: FocusRegionHandle;
  /** Normal graph rows: the Pending Changes row followed by commits. */
  readonly rows: readonly GraphDisplayRow[];
  /** Index of the selected normal graph row. */
  readonly activeIndex: number;
  /** True while the initial page loads. */
  readonly isLoadingInitial: boolean;
  /** True while an older page loads. */
  readonly isLoadingOlder: boolean;
  /** True while a parent or selected commit is loaded by the navigator. */
  readonly isLoadingParent: boolean;
  /** Bounded-miss row visibility. */
  readonly boundedMiss: boolean;
  /** Failed parent or search-result walk notice, or null. */
  readonly walkError: GraphWalkError | null;
  /** Page or parse failure message, or null. */
  readonly error: string | null;
  /** True when the repository has no commits. */
  readonly isEmpty: boolean;
  /** True when history is exhausted. */
  readonly isDone: boolean;
  /** Loaded commit count. */
  readonly loadedCount: number;
  /** Human-readable scope label. */
  readonly scopeLabel: string;
  /** Selected row identity when the provider selection is a graph row, otherwise null. */
  readonly selectedRowId: string | null;
  /** Scroll box the graph body mounts. */
  readonly scrollRef: RefObject<ScrollBoxRenderable | null>;
  /** Search view and delegates. */
  readonly search: CommitSearchHandle;
  /** Retries the failed page read. */
  readonly retry: () => void;
  /** Retries the failed window reload that owns a retryable walk notice. */
  readonly retryWalk: () => void;
  /** Moves the active cursor by a bounded row delta for one mouse-wheel event. */
  readonly scrollBy: (delta: number) => void;
  /** Selects a clicked normal row and confirms a double click. */
  readonly handleRowClick: (index: number) => void;
}

/** Snapshot of the inputs that make a tips effect pass a fresh convergence sequence. */
export interface TipsEffectContext {
  /** Paginator identity at the pass. */
  readonly paginator: GraphPaginator;
  /** Loaded page count at the pass. */
  readonly pagesLoaded: number;
  /** Whether search owned the surface at the pass. */
  readonly searchOpen: boolean;
}

/** Input of one tips effect pass owned by `useScopeTipsReload`. */
export interface TipsEffectInput {
  /** Context seen by the previous pass. */
  readonly contextRef: MutableRefObject<TipsEffectContext>;
  /** Current paginator. */
  readonly paginator: GraphPaginator;
  /** Current loaded page count. */
  readonly pagesLoaded: number;
  /** Current tip key. */
  readonly scopeTipsKey: string;
  /** Whether search owns the surface. */
  readonly searchOpen: boolean;
  /** Consecutive loops already started in this convergence sequence. */
  readonly roundsRef: MutableRefObject<number>;
  /** Paginator the record belongs to. */
  readonly tipsPaginatorRef: MutableRefObject<GraphPaginator>;
  /** Tip key a successful reload recorded. */
  readonly recordedTipsKeyRef: MutableRefObject<string>;
  /** In-flight guard of the reload loop. */
  readonly reloadingTipsRef: MutableRefObject<boolean>;
  /** Starts the bounded reload loop. */
  readonly reloadForTips: () => Promise<void>;
}
