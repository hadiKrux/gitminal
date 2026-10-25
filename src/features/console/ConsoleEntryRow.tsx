import type { ReactNode } from "react";
import { readConsoleEntryDetail } from "@/domain/console/console.rows";
import type { ConsoleEntry, ConsoleEntryDetail } from "@/domain/console/console.types";
import {
  CONSOLE_ROW_CWD_BUDGET_WIDTH,
  CONSOLE_ROW_CWD_LABEL,
  CONSOLE_ROW_INDENT,
  CONSOLE_ROW_INDENT_WIDTH,
} from "@/features/console/ConsoleEntryRow.constants";
import { ConsoleOutput } from "@/features/console/ConsoleOutput";
import { truncateText } from "@/lib/text";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";

/**
 * Renders one console entry with every documented field.
 *
 * The first line carries the selection marker, local time, operation label, status marker, exit
 * status, and duration. Command lines follow, then the working directory only when it differs from
 * the repository root, then the progress phase or short summary. Output expands through
 * `nav.activate` on the selected entry; failure entries arrive expanded because the provider marks
 * them on append. The operation label, exit status, and duration are never truncated away. The row
 * has no mouse handler, so keyboard selection and expansion are the only row interactions.
 *
 * @param props - Entry, selection and expansion state, and the row's content width.
 * @returns The entry row.
 */
export function ConsoleEntryRow(props: {
  readonly entry: ConsoleEntry;
  readonly selected: boolean;
  readonly expanded: boolean;
  readonly width: number;
}): ReactNode {
  const tokens = useTokens();
  const entry = props.entry;
  const status = readStatusView(entry.status, entry.exitCode, entry.summary, tokens);
  const marker = props.selected ? ICONS.selected : ICONS.unselected;
  const commandBudget = Math.max(8, props.width - CONSOLE_ROW_INDENT_WIDTH);
  const cwdBudget = Math.max(8, props.width - CONSOLE_ROW_CWD_BUDGET_WIDTH);
  const hasOutput = entry.steps.some(
    (step) => step.stdout.text.length > 0 || step.stderr.text.length > 0,
  );
  const detailLine = formatDetailLine(readConsoleEntryDetail(entry));

  return (
    <box
      id={entry.id}
      flexDirection="column"
      flexShrink={0}
      backgroundColor={props.selected ? tokens.selection : undefined}
    >
      <box flexDirection="row" height={1}>
        <text wrapMode="none">
          <span fg={props.selected ? tokens.focus : tokens.muted}>{marker}</span>
          <span fg={tokens.muted}>{` ${formatEntryTime(entry.at)} `}</span>
          <span fg={tokens.text}>{entry.operationLabel}</span>
          <span fg={status.color}>{` ${status.marker} ${status.label}`}</span>
          <span fg={tokens.dim}>{` ${formatDuration(entry.durationMs)}`}</span>
        </text>
        <box flexGrow={1} />
        <box flexShrink={0} paddingLeft={1}>
          <text fg={hasOutput ? tokens.muted : tokens.dim} wrapMode="none">
            {props.expanded ? ICONS.expanded : ICONS.collapsed}
          </text>
        </box>
      </box>

      {readKeyedSteps(entry).map(({ key, step }) => (
        <text key={key} fg={tokens.muted} wrapMode="none">
          {`${CONSOLE_ROW_INDENT}${truncateText(step.argv.join(" "), commandBudget, ICONS.ellipsis)}`}
        </text>
      ))}

      {entry.steps.length === 0 ? (
        <text fg={tokens.dim} wrapMode="none">
          {`${CONSOLE_ROW_INDENT}${entry.commandId}`}
        </text>
      ) : null}

      {entry.cwd === null ? null : (
        <text fg={tokens.dim} wrapMode="none">
          {`${CONSOLE_ROW_INDENT}${CONSOLE_ROW_CWD_LABEL} ${truncateText(entry.cwd, cwdBudget, ICONS.ellipsis)}`}
        </text>
      )}

      {detailLine === null ? null : (
        <text fg={tokens.dim} wrapMode="none">
          {`${CONSOLE_ROW_INDENT}${detailLine}`}
        </text>
      )}

      {props.expanded && hasOutput ? <ConsoleOutput steps={entry.steps} /> : null}
    </box>
  );
}

/**
 * Reads entry steps with a stable render key for each invocation.
 *
 * A step has no id, and the same git invocation can legally repeat inside a composite command, so
 * the key is built from the argv, exit code, duration, and the occurrence count of that combination.
 *
 * @param entry - Console entry.
 * @returns Steps paired with their stable keys.
 */
function readKeyedSteps(
  entry: ConsoleEntry,
): readonly { readonly key: string; readonly step: ConsoleEntry["steps"][number] }[] {
  const seen = new Map<string, number>();

  return entry.steps.map((step) => {
    const base = `${step.argv.join(" ")}|${step.exitCode}|${step.durationMs}`;
    const occurrence = (seen.get(base) ?? 0) + 1;

    seen.set(base, occurrence);

    return { key: `${entry.id}:${base}:${occurrence}`, step };
  });
}

/**
 * Formats an entry timestamp as a local clock value.
 *
 * @param at - Timestamp in milliseconds.
 * @returns `HH:MM:SS` in the user's local time zone.
 */
function formatEntryTime(at: number): string {
  return new Date(at).toTimeString().slice(0, 8);
}

/**
 * Formats a duration for the entry header.
 *
 * @param durationMs - Duration in milliseconds.
 * @returns A millisecond or one-decimal second value.
 */
function formatDuration(durationMs: number): string {
  return durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`;
}

/**
 * Reads the marker, label, and color for an entry outcome.
 *
 * A cancelled or timed-out entry never renders a success marker, even when the last child exited
 * zero after a cancellation race.
 *
 * @param status - Entry outcome.
 * @param exitCode - Last exit code, or null when no child exited, such as a post-result refresh failure.
 * @param summary - Entry summary, used for the timed-out duration.
 * @returns The status marker, label, and resolved token color.
 */
function readStatusView(
  status: ConsoleEntry["status"],
  exitCode: number | null,
  summary: string,
  tokens: ReturnType<typeof useTokens>,
): { readonly marker: string; readonly label: string; readonly color: string } {
  const exitLabel = exitCode === null ? "?" : String(exitCode);

  switch (status) {
    case "success":
      return { marker: ICONS.success, label: `exit ${exitLabel}`, color: tokens.success };
    case "failure":
      return {
        marker: ICONS.error,
        label: exitCode === null ? "failed" : `exit ${exitLabel}`,
        color: tokens.error,
      };
    case "cancelled":
      return { marker: ICONS.warning, label: "cancelled", color: tokens.warning };
    case "timed-out":
      return { marker: ICONS.warning, label: summary, color: tokens.warning };
  }
}

/**
 * Formats the detail line under the command from the shared phase and summary rule.
 *
 * The row measurement helper already omits a summary that the header names, so the two never
 * disagree about whether this line exists. A progress phase still renders on its own.
 *
 * @param detail - Visible phase and summary from `readConsoleEntryDetail`.
 * @returns The detail line, or null when there is nothing left to show.
 */
function formatDetailLine(detail: ConsoleEntryDetail): string | null {
  const phase = detail.phase === null ? null : `phase ${detail.phase}`;

  if (phase === null) {
    return detail.summary;
  }

  return detail.summary === null ? phase : `${phase} ${ICONS.hintSeparator} ${detail.summary}`;
}
