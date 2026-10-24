import type { ReactNode } from "react";
import type { StatusKind } from "@/app/hooks/useStatus";
import type { ThemeTokens } from "@/domain/theme/theme.types";
import { SyncStateBadge } from "@/features/top-bar/SyncStateBadge";
import { SYNC_BADGES } from "@/features/top-bar/SyncStateBadge.constants";
import {
  IDLE_SEPARATOR,
  PHASE_MIN_WIDTH,
  SPINNER_WIDTH,
  TOP_BAR_PROGRESS_ID,
} from "@/features/top-bar/TopBarStatus.constants";
import type { TopBarStatusMode } from "@/features/top-bar/useTopBar.types";
import { truncateText } from "@/lib/text";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import { ProgressBar } from "@/ui/ProgressBar";
import { PROGRESS_BAR_MAX_WIDTH, PROGRESS_BAR_MIN_WIDTH } from "@/ui/ProgressBar.constants";
import { Spinner } from "@/ui/Spinner";

/**
 * Renders the single top-bar status strip.
 *
 * The strip has exactly one mode with a fixed precedence: a running operation, then an active
 * transient message, then idle branch information. It is not focusable and registers no actions.
 * Every run is text, so the strip still reads with `NO_COLOR`; the progress bar is drawn only when a
 * percentage is known and at least eight cells remain, while its percentage always stays visible.
 *
 * @param props - Status mode, available columns, and whether the idle info control is focused.
 * @returns The one-row status strip content.
 */
export function TopBarStatus(props: {
  readonly mode: TopBarStatusMode;
  readonly width: number;
  readonly focused?: boolean;
}): ReactNode {
  const tokens = useTokens();

  if (props.mode.kind === "operation") {
    return renderOperationStatus(props.mode, props.width, tokens);
  }

  if (props.mode.kind === "status") {
    return renderMessageStatus(props.mode.statusKind, props.mode.message, props.width, tokens);
  }

  return renderIdleStatus(props.mode, Math.max(1, props.width), props.focused ?? false, tokens);
}

/**
 * Renders the running-operation mode.
 *
 * @param mode - Operation label, phase, and optional percentage.
 * @param width - Available columns.
 * @param tokens - Active theme tokens.
 * @returns The spinner or bar, phase text, and percentage.
 */
function renderOperationStatus(
  mode: Extract<TopBarStatusMode, { kind: "operation" }>,
  width: number,
  tokens: ThemeTokens,
): ReactNode {
  const percentText = readPercentText(mode.percent);
  const leadingWidth = mode.percent === null ? SPINNER_WIDTH : 0;
  const barWidth =
    mode.percent === null ? 0 : readProgressBarWidth(width - leadingWidth - percentText.length);
  const textBudget = Math.max(
    4,
    width - leadingWidth - percentText.length - (barWidth > 0 ? barWidth + 1 : 0),
  );
  const phaseText = readOperationText(mode, textBudget);

  return (
    <box flexDirection="row" height={1} flexShrink={1} overflow="hidden">
      {readOperationSpinner(mode.percent, tokens)}
      <text fg={tokens.text} wrapMode="none" flexShrink={1}>
        {phaseText}
      </text>
      {readOperationBar(mode.percent, barWidth)}
      {readPercentTextNode(percentText, tokens)}
    </box>
  );
}

/**
 * Formats the percentage run for an operation.
 *
 * @param percent - Known percentage, or null.
 * @returns The leading-space percentage text, or an empty string.
 */
function readPercentText(percent: number | null): string {
  return percent === null ? "" : ` ${Math.round(percent)}%`;
}

/**
 * Builds the operation label and phase text.
 *
 * @param mode - Operation label and phase.
 * @param textBudget - Available columns.
 * @returns The truncated label, or `label: phase` when the phase is distinct.
 */
function readOperationText(
  mode: Extract<TopBarStatusMode, { kind: "operation" }>,
  textBudget: number,
): string {
  return truncateText(
    mode.phase === mode.label ? mode.label : `${mode.label}: ${mode.phase}`,
    textBudget,
    ICONS.ellipsis,
  );
}

/**
 * Renders the leading spinner for an operation without a percentage.
 *
 * @param percent - Known percentage, or null.
 * @param tokens - Active theme tokens.
 * @returns The spinner and its separator, or null.
 */
function readOperationSpinner(percent: number | null, tokens: ThemeTokens): ReactNode {
  return percent === null ? (
    <>
      <Spinner />
      <text fg={tokens.muted}> </text>
    </>
  ) : null;
}

/**
 * Renders the progress bar and its separating space when a percentage is known and it fits.
 *
 * @param percent - Known percentage, or null.
 * @param barWidth - Bar width, or zero when hidden.
 * @returns The space and bar, or null.
 */
function readOperationBar(percent: number | null, barWidth: number): ReactNode {
  return percent !== null && barWidth > 0 ? (
    <>
      <text> </text>
      <ProgressBar id={TOP_BAR_PROGRESS_ID} percent={percent} width={barWidth} />
    </>
  ) : null;
}

/**
 * Renders the percentage run when one is known.
 *
 * @param percentText - Formatted percentage text.
 * @param tokens - Active theme tokens.
 * @returns The percentage text node, or null.
 */
function readPercentTextNode(percentText: string, tokens: ThemeTokens): ReactNode {
  return percentText.length === 0 ? null : (
    <text fg={tokens.muted} wrapMode="none" flexShrink={0}>
      {percentText}
    </text>
  );
}

/**
 * Renders a transient success, warning, error, or informational message.
 *
 * @param kind - Message severity.
 * @param message - Message text.
 * @param width - Available columns.
 * @param tokens - Active theme tokens.
 * @returns The marker plus the truncated message.
 */
function renderMessageStatus(
  kind: StatusKind,
  message: string,
  width: number,
  tokens: ThemeTokens,
): ReactNode {
  const marker = readStatusMarker(kind);
  const text = truncateText(message, Math.max(4, width - marker.length - 1), ICONS.ellipsis);

  return (
    <text fg={readStatusColor(kind, tokens)} wrapMode="none" flexShrink={1}>
      {`${marker} ${text}`}
    </text>
  );
}

/**
 * Renders idle branch information and the sync badge.
 *
 * During the first read the strip shows either the redacted error of a failed read or "loading
 * repository", so zero counts and a clean sync badge never pretend the repository is loaded. A
 * terminal repository state such as not-a-repository renders only its state label, because there is
 * no branch or sync relationship to show. Otherwise the branch and the sync badge are prioritized
 * over the upstream and the ahead and behind counts when the budget is tight.
 *
 * @param mode - Idle branch information.
 * @param width - Available columns.
 * @param focused - Whether the idle info control is the focused top-bar control.
 * @param tokens - Active theme tokens.
 * @returns The branch information and sync badge.
 */
function renderIdleStatus(
  mode: Extract<TopBarStatusMode, { kind: "idle" }>,
  width: number,
  focused: boolean,
  tokens: ThemeTokens,
): ReactNode {
  const focusMarker = focused ? `${ICONS.focus} ` : "";

  if (mode.initialError !== null) {
    const text = truncateText(
      mode.initialError,
      Math.max(4, width - ICONS.error.length - 1 - focusMarker.length),
      ICONS.ellipsis,
    );

    return (
      <text fg={tokens.error} wrapMode="none" flexShrink={1}>
        {`${focusMarker}${ICONS.error} ${text}`}
      </text>
    );
  }

  if (mode.loading) {
    return (
      <text fg={tokens.muted} wrapMode="none" flexShrink={1}>
        {`${focusMarker}loading repository`}
      </text>
    );
  }

  if (mode.gated) {
    return (
      <text fg={tokens.muted} wrapMode="none" flexShrink={1}>
        {`${focusMarker}${mode.stateLabel ?? "repository unavailable"}`}
      </text>
    );
  }

  const badge = SYNC_BADGES[mode.sync];
  const badgeWidth = badge.marker.length + 1 + badge.label.length;
  const leading = buildIdleText(mode);
  const leadingBudget = Math.max(1, width - badgeWidth - 1 - focusMarker.length);

  return (
    <box flexDirection="row" height={1} flexShrink={1} overflow="hidden">
      <text fg={tokens.muted} wrapMode="none" flexShrink={1}>
        {`${focusMarker}${truncateText(leading, leadingBudget, ICONS.ellipsis)}`}
      </text>
      <text> </text>
      <SyncStateBadge sync={mode.sync} tokens={tokens} />
    </box>
  );
}

/**
 * Builds the idle leading text run.
 *
 * @param mode - Idle branch information.
 * @returns The branch, upstream, counts, and state label joined for display.
 */
function buildIdleText(mode: Extract<TopBarStatusMode, { kind: "idle" }>): string {
  const parts = [mode.detached ? `${mode.branchLabel} detached` : mode.branchLabel];

  if (mode.upstreamLabel !== null) {
    parts.push(
      mode.upstreamMissing ? `${ICONS.missingUpstream} ${mode.upstreamLabel}` : mode.upstreamLabel,
    );

    // A missing or unconfirmed upstream ref makes the comparison unknown, so ahead and behind are
    // hidden instead of showing a misleading zero.
    if (!mode.upstreamMissing) {
      parts.push(`ahead ${mode.ahead} behind ${mode.behind}`);
    }
  }

  if (mode.stateLabel !== null) {
    parts.push(mode.stateLabel);
  }

  return parts.join(IDLE_SEPARATOR);
}

/**
 * Resolves the width available to the progress bar.
 *
 * @param available - Columns left after the phase and percentage.
 * @returns A width between 8 and 24 cells, or zero when the bar must be hidden.
 */
function readProgressBarWidth(available: number): number {
  if (available < PROGRESS_BAR_MIN_WIDTH + PHASE_MIN_WIDTH) {
    return 0;
  }

  return Math.min(PROGRESS_BAR_MAX_WIDTH, available - PHASE_MIN_WIDTH);
}

/**
 * Reads the text marker for a message severity.
 *
 * @param kind - Message severity.
 * @returns The marker from `ICONS`.
 */
function readStatusMarker(kind: StatusKind): string {
  switch (kind) {
    case "success":
      return ICONS.success;
    case "warning":
      return ICONS.warning;
    case "error":
      return ICONS.error;
    case "info":
      return ICONS.info;
  }
}

/**
 * Reads the theme color for a message severity.
 *
 * @param kind - Message severity.
 * @param tokens - Active theme tokens.
 * @returns The matching token color.
 */
function readStatusColor(kind: StatusKind, tokens: ThemeTokens): string {
  switch (kind) {
    case "success":
      return tokens.success;
    case "warning":
      return tokens.warning;
    case "error":
      return tokens.error;
    case "info":
      return tokens.info;
  }
}
