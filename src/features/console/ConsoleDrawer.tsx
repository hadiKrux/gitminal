import type { ScrollBoxRenderable } from "@opentui/core";
import { useRenderer, useSelectionHandler } from "@opentui/react";
import type { ReactNode } from "react";
import { useConsoleLog } from "@/app/hooks/useConsoleLog";
import { useStatus } from "@/app/hooks/useStatus";
import {
  CONSOLE_DRAWER_BORDER_WIDTH,
  CONSOLE_EMPTY_MESSAGE,
  CONSOLE_ENTRY_COUNT_PLURAL,
  CONSOLE_ENTRY_COUNT_SINGULAR,
  CONSOLE_FOLLOW_LABEL,
  CONSOLE_NEW_ENTRY_PLURAL,
  CONSOLE_NEW_ENTRY_SINGULAR,
  CONSOLE_PAUSED_LABEL,
} from "@/features/console/ConsoleDrawer.constants";
import { ConsoleEntryRow } from "@/features/console/ConsoleEntryRow";
import { useConsole } from "@/features/console/useConsole";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import { Spinner } from "@/ui/Spinner";
import { useScrollbarOptions } from "@/ui/useScrollbarOptions";
import { useTerminalDimensions } from "@/ui/useTerminalDimensions";

/**
 * Renders the non-modal console drawer docked above the footer.
 *
 * The drawer reads the history, follow mode, and expansion state from `ConsoleProvider`; the cursor
 * and viewport ref come from `useConsole`. The header shows the entry count and whether follow mode
 * is active, the body is a bounded `<scrollbox>` of custom entry rows, and the footer's context
 * hints are the only key legend, so every advertised key comes from the effective keymap. A running
 * command renders a spinner row instead of an in-progress entry, because entries are appended only
 * when a result settles. Selection and expansion are keyboard-only: `nav.*` moves the cursor and
 * `nav.activate` toggles the selected entry. Text selection copies through the renderer's OSC 52
 * clipboard helper.
 *
 * @returns The console drawer.
 */
export function ConsoleDrawer(): ReactNode {
  const tokens = useTokens();
  const scrollbarOptions = useScrollbarOptions();
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  const log = useConsoleLog();
  const { operation, setStatus } = useStatus();
  const view = useConsole();
  const entries = log.entries;
  const contentWidth = Math.max(1, dimensions.width - CONSOLE_DRAWER_BORDER_WIDTH);

  useSelectionHandler((selection) => {
    if (selection.isDragging) {
      return;
    }

    const text = selection.getSelectedText();

    if (text.trim().length === 0) {
      return;
    }

    if (renderer.copyToClipboardOSC52(text)) {
      setStatus({ kind: "info", message: "Selection copied" });
    }
  });

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexDirection="row" height={1} flexShrink={0}>
        <text fg={tokens.muted} wrapMode="none">
          {`${entries.length} ${readCountLabel(entries.length, CONSOLE_ENTRY_COUNT_SINGULAR, CONSOLE_ENTRY_COUNT_PLURAL)}`}
        </text>
        <box flexGrow={1} />
        {log.newEntryCount > 0 ? (
          <text fg={tokens.warning} wrapMode="none">
            {`${ICONS.info} ${log.newEntryCount} ${readCountLabel(log.newEntryCount, CONSOLE_NEW_ENTRY_SINGULAR, CONSOLE_NEW_ENTRY_PLURAL)}`}
          </text>
        ) : null}
        <text fg={log.followMode ? tokens.success : tokens.dim} wrapMode="none">
          {` ${log.followMode ? CONSOLE_FOLLOW_LABEL : CONSOLE_PAUSED_LABEL}`}
        </text>
      </box>

      <scrollbox
        ref={view.scrollRef}
        flexGrow={1}
        flexShrink={1}
        focusable={false}
        viewportCulling
        scrollbarOptions={scrollbarOptions}
        stickyScroll={log.followMode}
        stickyStart="bottom"
        onMouseScroll={(event) => {
          const scroll = event.scroll;

          if (scroll === undefined) {
            return;
          }

          if (scroll.direction === "up") {
            log.setFollowing(false);
            return;
          }

          if (scroll.direction === "down" && isViewportAtBottom(view.scrollRef.current)) {
            log.setFollowing(true);
          }
        }}
      >
        {entries.length === 0 && operation === null ? (
          <text fg={tokens.dim} wrapMode="none">
            {`${ICONS.pending} ${CONSOLE_EMPTY_MESSAGE}`}
          </text>
        ) : null}

        {entries.map((entry) => (
          <ConsoleEntryRow
            key={entry.id}
            entry={entry}
            selected={view.selectedEntryId === entry.id}
            expanded={view.isExpanded(entry.id)}
            width={contentWidth}
          />
        ))}

        {operation === null ? null : (
          <box flexDirection="row" height={1} flexShrink={0}>
            <Spinner />
            <text fg={tokens.muted} wrapMode="none">
              {` ${operation.label} ${operation.phase}${readPercent(operation.percent)}`}
            </text>
          </box>
        )}
      </scrollbox>
    </box>
  );
}

/**
 * Selects a singular or plural count label.
 *
 * @param count - Number being described.
 * @param singular - Label for exactly one.
 * @param plural - Label for every other count.
 * @returns The matching label.
 */
function readCountLabel(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

/**
 * Formats the running-operation percentage suffix.
 *
 * @param percent - Known percentage, or null when git has not reported one.
 * @returns An empty string or a space-prefixed percentage.
 */
function readPercent(percent: number | null): string {
  return percent === null ? "" : ` ${Math.round(percent)}%`;
}

/**
 * Reports whether the log viewport is scrolled to its bottom.
 *
 * @param viewport - Log scrollbox, or null before mount.
 * @returns True when the last row is visible, or when no viewport exists yet.
 */
function isViewportAtBottom(viewport: ScrollBoxRenderable | null): boolean {
  if (viewport === null) {
    return true;
  }

  return viewport.scrollTop >= viewport.scrollHeight - viewport.viewport.height - 1;
}
