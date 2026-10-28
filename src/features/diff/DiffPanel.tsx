import type { ScrollBoxRenderable } from "@opentui/core";
import { type ReactNode, useRef } from "react";
import { useScrollContentWidth } from "@/app/hooks/useScrollContentWidth";
import { useScrollSelectedRow } from "@/app/hooks/useScrollSelectedRow";
import type { DiffFileView } from "@/domain/repository/repository.types";
import { ConflictBanner } from "@/features/diff/ConflictBanner";
import { DiffContent } from "@/features/diff/DiffContent";
import { DiffFileRow } from "@/features/diff/DiffFileRow";
import { DiffSection } from "@/features/diff/DiffSection";
import { DIFF_SCROLL_ID, DIFF_SCROLLBAR_WIDTH } from "@/features/diff/diffPanel.constants";
import { useDiffPanel } from "@/features/diff/useDiffPanel";
import { useDiffScroll } from "@/features/diff/useDiffScroll";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import { EmptyState } from "@/ui/EmptyState";
import { ErrorState } from "@/ui/ErrorState";
import { LoadingRow } from "@/ui/LoadingRow";
import { Panel } from "@/ui/Panel";
import { useScrollbarOptions } from "@/ui/useScrollbarOptions";

/** Loading label while the first status read is in flight. */
const DIFF_SECTIONS_LOADING_LABEL = "loading changes";

/** Loading label while a commit or stash diff is in flight. */
const DIFF_READ_ONLY_LOADING_LABEL = "loading diff";

/** Text shown while another mutation owns the write slot. */
const DIFF_BUSY_MESSAGE = "operation in progress - actions are disabled";

/** Status error message. */
const DIFF_STATUS_ERROR_MESSAGE = "Could not read status";

/** Read-only diff error message. */
const DIFF_READ_ONLY_ERROR_MESSAGE = "Could not read diff";

/** Read-only empty message. */
const DIFF_READ_ONLY_EMPTY_MESSAGE = "No changed files";

/**
 * Renders the Diff panel.
 *
 * The panel owns its `diff` region frame, its border, and one culled scrollbox, so the shell
 * composition root must place it directly instead of wrapping it in another frame. In pending mode
 * it renders the three sections in F-11 order with their file rows and expanded content. In read-only
 * mode it renders one list of the selected commit's or stash's changed files, expanded, with no
 * stage, unstage, discard, or delete actions. Loading, empty, error, busy, conflict, and operation
 * notices all render as text.
 *
 * The panel scrolls its one scrollbox from the keyboard: `J`/`K` move one line, `Shift+Down` and
 * `Shift+Up` move five, and `H`/`L` plus `Shift+Left`/`Shift+Right` move eight columns. Those offsets
 * are viewport state only, so every expanded file shares them and the selected row never moves.
 * The scroll keys are the supported keyboard horizontal controls: the scrollbox's horizontal
 * scrollbar is hidden to protect the panel frame, while the vertical scrollbar stays visible and
 * reserves its own column so it stays inside the panel frame even when a long diff line widens the
 * content.
 * Shift+wheel or a horizontal wheel can still move the offset when the terminal reports it. `j`/`k`
 * keep moving the row cursor and `useScrollSelectedRow` reveals the selected row again after it
 * leaves the viewport. Because the installed renderable clips long lines, each expanded diff is sized
 * to its longest line while the section headers, file rows, empty states, and notices stay within
 * the measured panel width, and every padded wrapper subtracts its indent from the width it hands to
 * its children, so only diff content becomes horizontally scrollable.
 *
 * @returns The composed diff panel.
 */
export function DiffPanel(): ReactNode {
  const panel = useDiffPanel();
  const tokens = useTokens();
  const scrollbarOptions = useScrollbarOptions();
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const { width, onSizeChange } = useScrollContentWidth(scrollRef);
  const diffScroll = useDiffScroll(scrollRef);

  useScrollSelectedRow(panel.selectedId, panel.selectedIndex, diffScroll.scrollTarget);

  return (
    <Panel
      {...panel.region.regionProps}
      focused={panel.region.focused}
      title={panel.readOnly ? panel.readOnlyTitle : "Diffs"}
      flexGrow={1}
      flexBasis={0}
      minHeight={3}
    >
      <box flexDirection="column" flexGrow={1} flexShrink={1}>
        {panel.busy ? (
          <text id="diff-busy" fg={tokens.warning} wrapMode="word">
            {`${ICONS.warning} ${DIFF_BUSY_MESSAGE}`}
          </text>
        ) : null}
        {panel.error === null ? null : (
          <ErrorState
            message={DIFF_STATUS_ERROR_MESSAGE}
            details={panel.error}
            onRetry={panel.retry}
          />
        )}
        {panel.loading ? <LoadingRow label={DIFF_SECTIONS_LOADING_LABEL} /> : null}
        {panel.readOnly ? null : (
          <ConflictBanner conflictedFiles={panel.conflictedFiles} operation={panel.operation} />
        )}
        <scrollbox
          id={DIFF_SCROLL_ID}
          ref={scrollRef}
          onSizeChange={onSizeChange}
          flexGrow={1}
          flexShrink={1}
          focusable={false}
          viewportCulling
          scrollX
          scrollY
          scrollbarOptions={scrollbarOptions}
          // The explicit one-column width reserves the scrollbar column instead of letting the
          // auto-sized bar sit one cell past the scrollbox right edge and overlay the panel border
          // once a diff line widens the content past the viewport.
          verticalScrollbarOptions={{ width: DIFF_SCROLLBAR_WIDTH }}
          // OpenTUI draws the horizontal bar in the last row of the panel body on the bottom edge of
          // the frame, so the bar is deliberately hidden and the scroll keys remain the supported
          // keyboard horizontal controls.
          horizontalScrollbarOptions={{ visible: false }}
        >
          {panel.readOnly ? renderReadOnly(panel, width) : renderSections(panel, width)}
        </scrollbox>
      </box>
    </Panel>
  );
}

/**
 * Renders the read-only commit or stash file list.
 *
 * File rows use the measured panel width, while each expanded diff sits in a one-cell indented
 * wrapper and therefore receives that width minus the indent.
 *
 * @param panel - Diff panel handle.
 * @param width - Measured panel content width.
 * @returns The loading, error, empty, or file list body.
 */
function renderReadOnly(panel: ReturnType<typeof useDiffPanel>, width: number): ReactNode {
  if (panel.readOnlyState.status === "idle" || panel.readOnlyState.status === "loading") {
    return (
      <box maxWidth={width} flexShrink={0}>
        <LoadingRow label={DIFF_READ_ONLY_LOADING_LABEL} />
      </box>
    );
  }

  if (panel.readOnlyState.status === "error") {
    return (
      <box maxWidth={width} flexShrink={0}>
        <ErrorState
          message={DIFF_READ_ONLY_ERROR_MESSAGE}
          details={panel.readOnlyState.message ?? undefined}
          onRetry={panel.retryReadOnly}
        />
      </box>
    );
  }

  if (panel.readOnlyFiles.length === 0) {
    return (
      <box maxWidth={width} flexShrink={0}>
        <EmptyState message={DIFF_READ_ONLY_EMPTY_MESSAGE} />
      </box>
    );
  }

  return (
    <box flexDirection="column" flexShrink={0}>
      {panel.readOnlyFiles.map((file) => (
        <box key={file.id} flexDirection="column" flexShrink={0}>
          <box maxWidth={width} flexShrink={0}>
            <DiffFileRow
              file={file}
              width={width}
              selected={panel.selectedId === file.id}
              focused={panel.region.focused}
              expanded={panel.isFileExpanded(file)}
              counts={panel.countsFor(file)}
              actions={panel.fileActions(file)}
              onToggle={() => panel.toggleFile(file)}
              onMouseDown={() => panel.clickRow(file.id)}
            />
          </box>
          {panel.isFileExpanded(file) ? (
            <box flexDirection="column" flexShrink={0} paddingLeft={1}>
              <DiffContent
                path={file.path}
                width={Math.max(0, width - 1)}
                state={panel.readOnlyFileState(file)}
                onRetry={panel.retryReadOnly}
              />
            </box>
          ) : null}
        </box>
      ))}
    </box>
  );
}

/**
 * Renders the three pending-change sections.
 *
 * Section headers use the measured panel width. Files and empty states live in each section's
 * one-cell indented expanded body and therefore receive that width minus the indent.
 *
 * @param panel - Diff panel handle.
 * @param width - Measured panel content width.
 * @returns The section list.
 */
function renderSections(panel: ReturnType<typeof useDiffPanel>, width: number): ReactNode {
  return (
    <box flexDirection="column" flexShrink={0}>
      {panel.sections.map((section) => (
        <DiffSection
          key={section.section}
          view={section}
          width={width}
          expanded={panel.expandedSections[section.section]}
          selected={panel.selectedId === `section::${section.section}`}
          focused={panel.region.focused}
          emptyText={panel.sectionEmptyText(section.section)}
          bulkActions={panel.sectionActions(section)}
          onToggle={() => panel.toggleSection(section.section)}
          onMouseDown={() => panel.clickRow(`section::${section.section}`)}
          renderFile={(file) => renderFile(panel, file, Math.max(0, width - 1))}
        />
      ))}
    </box>
  );
}

/**
 * Renders one file row and its expanded content.
 *
 * @param panel - Diff panel handle.
 * @param file - File row.
 * @param width - Width available inside the section's padded expanded body.
 * @returns The row and, when expanded, its diff content.
 */
function renderFile(
  panel: ReturnType<typeof useDiffPanel>,
  file: DiffFileView,
  width: number,
): ReactNode {
  return (
    <box key={file.id} flexDirection="column" flexShrink={0}>
      <box maxWidth={width} flexShrink={0}>
        <DiffFileRow
          file={file}
          width={width}
          selected={panel.selectedId === file.id}
          focused={panel.region.focused}
          expanded={panel.isFileExpanded(file)}
          counts={panel.countsFor(file)}
          actions={panel.fileActions(file)}
          onToggle={() => panel.toggleFile(file)}
          onMouseDown={() => panel.clickRow(file.id)}
        />
      </box>
      {panel.isFileExpanded(file) ? (
        <box flexDirection="column" flexShrink={0} paddingLeft={1}>
          <DiffContent
            path={file.path}
            width={Math.max(0, width - 1)}
            state={panel.fileState(file)}
            onRetry={() => panel.retryFile(file)}
          />
        </box>
      ) : null}
    </box>
  );
}
