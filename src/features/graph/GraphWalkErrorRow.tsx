import type { ReactNode } from "react";
import {
  GRAPH_FOOTER_ROW_GAP,
  GRAPH_FOOTER_ROW_INDENT,
  GRAPH_RETRY_LABEL,
  GRAPH_WALK_RETRY_ID,
} from "@/features/graph/graph.constants";
import type { GraphWalkError } from "@/features/graph/graph.types";
import { truncateText } from "@/lib/text";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import { Button } from "@/ui/Button";
import { BUTTON_HORIZONTAL_PADDING } from "@/ui/Button.constants";

/** Columns the Retry button occupies, including its label and horizontal padding. */
const RETRY_BUTTON_WIDTH = GRAPH_RETRY_LABEL.length + BUTTON_HORIZONTAL_PADDING * 2;

/**
 * Renders one failed bounded commit walk as a warning row.
 *
 * The notice is deliberately separate from `ErrorState`: a walk failure is not a page-load failure of
 * the visible window, and its Retry must not run another read by sharing the page Retry dispatcher.
 * When the walk belonged to a failed window reload, the row offers a Retry that always re-runs that
 * reload; a plain selection walk offers none and is retried by selecting the commit again. The
 * message is truncated to the measured footer width so the row stays one line and the Retry button
 * stays visible in the narrowest supported graph slot.
 *
 * @param props - Walk error notice, the measured footer width, and the Retry action.
 * @returns The warning row, with a Retry button only for a retryable walk.
 */
export function GraphWalkErrorRow(props: {
  readonly error: GraphWalkError;
  readonly width: number;
  readonly onRetry: () => void;
}): ReactNode {
  const tokens = useTokens();
  const actionWidth =
    props.error.retryable === true ? RETRY_BUTTON_WIDTH + GRAPH_FOOTER_ROW_GAP : 0;
  const messageBudget = Math.max(
    0,
    Math.floor(props.width) - GRAPH_FOOTER_ROW_INDENT - actionWidth,
  );

  return (
    <box
      flexDirection="row"
      flexShrink={0}
      height={1}
      paddingLeft={GRAPH_FOOTER_ROW_INDENT}
      gap={GRAPH_FOOTER_ROW_GAP}
    >
      <text fg={tokens.warning} wrapMode="none" flexShrink={1}>
        {truncateText(props.error.message, messageBudget, ICONS.ellipsis)}
      </text>
      {props.error.retryable ? (
        <Button id={GRAPH_WALK_RETRY_ID} label={GRAPH_RETRY_LABEL} onPress={props.onRetry} />
      ) : null}
    </box>
  );
}
