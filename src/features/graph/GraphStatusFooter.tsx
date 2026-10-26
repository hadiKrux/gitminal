import type { ReactNode } from "react";
import { GraphWalkErrorRow } from "@/features/graph/GraphWalkErrorRow";
import {
  GRAPH_END_OF_HISTORY_MESSAGE,
  GRAPH_FOOTER_ROW_INDENT,
  GRAPH_LOAD_ERROR_MESSAGE,
  GRAPH_OLDER_LOADING_LABEL,
  GRAPH_RETRY_ID,
} from "@/features/graph/graph.constants";
import type { GraphWalkError } from "@/features/graph/graph.types";
import { useTokens } from "@/theme/useTokens";
import { ErrorState } from "@/ui/ErrorState";
import { LoadingRow } from "@/ui/LoadingRow";

/**
 * Renders the fixed graph status footer below the scrollbox.
 *
 * The older-page loading row, the distinct walk notice, the page error with Retry, and the
 * end-of-history marker live here instead of inside the virtualized scrollbox. Keeping them outside
 * the scrollbox means they stay visible when the mounted row window fills the panel and the top
 * anchored viewport would otherwise clip them. Every row is bounded at the measured graph width: the
 * loading and walk rows take one line, the page error truncates its message and details to one line
 * each, and the end marker wraps to at most two lines. The footer therefore cannot consume the body
 * and push its own Retry out of the panel in the narrowest supported graph slot. The walk Retry and
 * the page Retry are separate callbacks because a walk failure belongs to a failed window reload and
 * must not run the older-page read that a page failure retries.
 *
 * @param props - Loading, walk-error, page-error, and end-of-history state, the measured width, and
 * the page and walk Retry actions.
 * @returns The status footer, or null when no status row applies.
 */
export function GraphStatusFooter(props: {
  readonly isLoadingOlder: boolean;
  readonly walkError: GraphWalkError | null;
  readonly pageError: string | null;
  readonly isDone: boolean;
  readonly width: number;
  readonly onRetry: () => void;
  readonly onWalkRetry: () => void;
}): ReactNode {
  const tokens = useTokens();
  const hasStatus =
    props.isLoadingOlder || props.walkError !== null || props.pageError !== null || props.isDone;

  if (!hasStatus) {
    return null;
  }

  return (
    <box flexDirection="column" flexShrink={0}>
      {props.isLoadingOlder ? <LoadingRow label={GRAPH_OLDER_LOADING_LABEL} /> : null}
      {props.walkError === null ? null : (
        <GraphWalkErrorRow
          error={props.walkError}
          width={props.width}
          onRetry={props.onWalkRetry}
        />
      )}
      {props.pageError === null ? null : (
        <ErrorState
          message={GRAPH_LOAD_ERROR_MESSAGE}
          details={readPageErrorDetails(props.pageError)}
          onRetry={props.onRetry}
          retryId={GRAPH_RETRY_ID}
          compactWidth={props.width}
        />
      )}
      {props.isDone ? (
        <box flexDirection="row" flexShrink={0} paddingLeft={GRAPH_FOOTER_ROW_INDENT} maxHeight={2}>
          <text fg={tokens.dim} wrapMode="word">
            {GRAPH_END_OF_HISTORY_MESSAGE}
          </text>
        </box>
      ) : null}
    </box>
  );
}

/**
 * Reads the details line for the page error row.
 *
 * The row already renders the generic page-load message, so a real error message is shown only when
 * it differs. That keeps a page failure whose message is the generic fallback from printing the same
 * line twice.
 *
 * @param error - Real page error message.
 * @returns The details line, or undefined when it would repeat the message.
 */
export function readPageErrorDetails(error: string): string | undefined {
  return error === GRAPH_LOAD_ERROR_MESSAGE ? undefined : error;
}
