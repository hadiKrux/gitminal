import type { ReactNode } from "react";
import type { RemoteFreshness } from "@/domain/repository/repository.types";
import {
  REMOTE_ROW_CONTENT_MIN_WIDTH,
  REMOTE_ROW_INDENT_WIDTH,
  REMOTE_ROW_MARKER_SEPARATOR_WIDTH,
  REMOTE_ROW_MIN_NAME_WIDTH,
  REMOTE_ROW_STALE_INDICATOR,
} from "@/features/remotes/RemoteRow.constants";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import { ListRow } from "@/ui/ListRow";
import { PANEL_BORDER_WIDTH, PANEL_SCROLLBAR_WIDTH } from "@/ui/Panel.constants";
import { usePanelScroll } from "@/ui/PanelScrollContext";
import { TruncatedText } from "@/ui/TruncatedText";
import { useTerminalDimensions } from "@/ui/useTerminalDimensions";

/**
 * Renders one remote-tracking branch row.
 *
 * The row is a single line: a one-cell indent, the branch name without its remote prefix, and an
 * inline freshness marker when the remote is not fresh. A leading `[L]` means at least one local branch
 * tracks this exact remote/branch, regardless of its local name or checkout state. It is not a same-name
 * existence marker. The remote group header supplies remote context;
 * row identity and command targets remain remote-qualified. The indent aligns the name with the group header. The name is
 * truncated with `TruncatedText` using the drawable width of the surrounding panel, which already
 * excludes the border and the reserved scrollbar column, and the indent, local-tracker, and freshness marker widths
 * are reserved first, so the freshness marker and its separator are never the clipped part. Outside
 * a panel frame the budget falls back to the terminal width minus the panel border and the scrollbar
 * column. The row does not use the `ListRow` selection marker: the dark selected fill already
 * identifies the cursor row. Freshness is a caller-supplied classification derived from the
 * per-remote last successful check or fetch timestamp, never from the ref committer date: `stale`
 * shows `[stale]`, `unknown` shows the missing-state marker, and `fresh` adds no marker. A failed,
 * cancelled, timed-out, or never-run check therefore never reads as absent, deleted, or unpushed.
 *
 * @param props - Row identity, branch data, freshness, selection flags, and the mouse handler.
 * @returns The composed remote branch row.
 */
export function RemoteRow(props: {
  readonly id: string;
  readonly remote: string;
  readonly branch: string;
  readonly freshness: RemoteFreshness;
  readonly hasLocalTracker?: boolean;
  readonly selected: boolean;
  readonly focused: boolean;
  readonly onMouseDown: () => void;
}): ReactNode {
  const tokens = useTokens();
  const dimensions = useTerminalDimensions();
  const panelScroll = usePanelScroll();
  const drawableWidth =
    panelScroll?.drawableWidth ??
    Math.max(0, dimensions.width - PANEL_BORDER_WIDTH - PANEL_SCROLLBAR_WIDTH);
  const indicator = readFreshnessIndicator(props.freshness);
  const nameBudget = readNameBudget(drawableWidth, indicator, props.hasLocalTracker === true);

  return (
    <ListRow
      id={props.id}
      selected={props.selected}
      focused={props.focused}
      showMarker={false}
      onMouseDown={props.onMouseDown}
    >
      <box flexDirection="row" flexShrink={1} overflow="hidden">
        <text wrapMode="none" flexShrink={0}>
          {" "}
        </text>
        {props.hasLocalTracker === true ? (
          <text
            fg={tokens.muted}
            wrapMode="none"
            flexShrink={0}
          >{`${ICONS.remoteLocalTracker} `}</text>
        ) : null}
        <TruncatedText text={props.branch} maxWidth={nameBudget} />
        {indicator === null ? null : (
          <text fg={tokens.warning} wrapMode="none" flexShrink={0}>
            {` ${indicator}`}
          </text>
        )}
      </box>
    </ListRow>
  );
}

/**
 * Reads the text marker for a freshness value.
 *
 * @param freshness - Classification from the repository selector.
 * @returns The marker text, or null for a fresh remote.
 */
function readFreshnessIndicator(freshness: RemoteFreshness): string | null {
  switch (freshness) {
    case "fresh":
      return null;
    case "stale":
      return REMOTE_ROW_STALE_INDICATOR;
    case "unknown":
      return ICONS.missingUpstream;
  }
}

/**
 * Reads how many cells the remote branch name may occupy.
 *
 * The panel's drawable width is kept at or above a readable minimum, and the leading indent and
 * inline freshness marker plus its separator are reserved. The name is the only part that truncates,
 * so the indent, separator, and marker always stay visible.
 *
 * @param drawableWidth - Drawable width of the surrounding panel in cells.
 * @param indicator - Freshness marker text, or null when the remote is fresh.
 * @param hasLocalTracker - Whether to reserve the tracking marker and its separator.
 * @returns The name budget, never below the minimum name width.
 */
function readNameBudget(
  drawableWidth: number,
  indicator: string | null,
  hasLocalTracker: boolean,
): number {
  const rowWidth = Math.max(REMOTE_ROW_CONTENT_MIN_WIDTH, Math.max(1, drawableWidth));
  const markerWidth = indicator === null ? 0 : indicator.length + REMOTE_ROW_MARKER_SEPARATOR_WIDTH;

  const trackerWidth = hasLocalTracker
    ? ICONS.remoteLocalTracker.length + REMOTE_ROW_MARKER_SEPARATOR_WIDTH
    : 0;
  return Math.max(
    REMOTE_ROW_MIN_NAME_WIDTH,
    rowWidth - REMOTE_ROW_INDENT_WIDTH - markerWidth - trackerWidth,
  );
}
