import type { ReactNode } from "react";
import type { DiffLoadState } from "@/domain/diff/diff.types";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import { EmptyState } from "@/ui/EmptyState";
import { ErrorState } from "@/ui/ErrorState";
import { LoadingRow } from "@/ui/LoadingRow";

/** Loading label shown while the lazy file read is in flight. */
const DIFF_LOADING_LABEL = "loading diff";

/** Notice for a binary file. */
const DIFF_BINARY_NOTICE = "Binary file - preview unavailable";

/** Notice for a file whose known size exceeds the preview cap. */
const DIFF_OVERSIZED_NOTICE = "File too large to preview";

/** Notice for a file whose only change is a mode pair. */
const DIFF_METADATA_ONLY_NOTICE = "Mode change only - no content lines";

/** Notice for a patch with no renderable content. */
const DIFF_NO_CONTENT_NOTICE = "No content lines to preview";

/** Prefix of the truncation notice, followed by the shown and total line counts. */
const DIFF_TRUNCATION_PREFIX = "diff truncated - showing";

/** Notice for a conflicted file. */
const DIFF_CONFLICT_NOTICE = "Conflicted file - resolve it externally, then stage it";

/** Compact size thresholds for the oversized notice. */
const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * 1024;

/**
 * Renders the inline unified diff of one expanded file.
 *
 * A loaded text file becomes one `<diff>` per kept segment, with unified view, one line-number
 * gutter, and theme-mapped added and removed backgrounds and signs. A collapsed segment becomes a
 * text marker, because the renderer only ever receives complete unified patches. Binary, oversized,
 * metadata-only, empty, and truncated files each render their own notice with text. Loading and
 * failure states stay inline so the row stays expanded and Retry re-runs only this file.
 *
 * @param props - Target path, load state, and the Retry callback.
 * @returns The composed diff content.
 */
export function DiffContent(props: {
  readonly path: string;
  readonly state: DiffLoadState | undefined;
  readonly onRetry: () => void;
}): ReactNode {
  const tokens = useTokens();
  const state = props.state;

  if (state === undefined || state.status === "idle" || state.status === "loading") {
    return <LoadingRow label={DIFF_LOADING_LABEL} />;
  }

  if (state.status === "error") {
    return (
      <ErrorState
        message={`Could not read diff for ${props.path}`}
        details={state.message ?? undefined}
        onRetry={props.onRetry}
      />
    );
  }

  if (state.status === "binary") {
    return (
      <text fg={tokens.muted} wrapMode="word">
        {`${ICONS.info} ${DIFF_BINARY_NOTICE}`}
      </text>
    );
  }

  if (state.status === "oversized") {
    return (
      <text fg={tokens.muted} wrapMode="word">
        {`${ICONS.info} ${DIFF_OVERSIZED_NOTICE} (${formatBytes(state.sizeBytes)})`}
      </text>
    );
  }

  return (
    <box flexDirection="column" flexShrink={0}>
      {state.file?.conflict === true ? (
        <text fg={tokens.warning} wrapMode="word">
          {`${ICONS.warning} ${DIFF_CONFLICT_NOTICE}`}
        </text>
      ) : null}
      {state.file?.modeOnly === true ? (
        <>
          <text fg={tokens.muted} wrapMode="word">
            {`${ICONS.info} ${DIFF_METADATA_ONLY_NOTICE}`}
          </text>
          {state.file.headerLines.map((line) => (
            <text key={line} fg={tokens.muted} wrapMode="none">
              {line}
            </text>
          ))}
        </>
      ) : null}
      {state.segments.map((segment) =>
        segment.kind === "collapsed" ? (
          <text
            key={`collapsed:${segment.oldStart}:${segment.newStart}:${segment.count}`}
            fg={tokens.diffContext}
            wrapMode="none"
          >
            {`${segment.count} unchanged lines`}
          </text>
        ) : (
          <diff
            key={`diff:${segment.hunkIndex}:${segment.oldStart}:${segment.newStart}`}
            diff={segment.text}
            view="unified"
            showLineNumbers
            addedBg={tokens.diffAddBackground}
            removedBg={tokens.diffRemoveBackground}
            addedSignColor={tokens.diffAdd}
            removedSignColor={tokens.diffRemove}
          />
        ),
      )}
      {state.limits?.truncated === true ? (
        <text fg={tokens.warning} wrapMode="word">
          {`${ICONS.warning} ${DIFF_TRUNCATION_PREFIX} ${state.limits.shownLines} of ${state.limits.totalLines} lines`}
        </text>
      ) : null}
      {hasNothingToRender(state) ? <EmptyState message={DIFF_NO_CONTENT_NOTICE} /> : null}
    </box>
  );
}

/**
 * Reports whether a loaded file produced no diff segment and no dedicated notice.
 *
 * @param state - Loaded file state.
 * @returns True when the panel must explain that there is nothing to preview.
 */
function hasNothingToRender(state: DiffLoadState): boolean {
  return (
    state.status === "loaded" &&
    state.segments.length === 0 &&
    state.file?.binary !== true &&
    state.file?.modeOnly !== true
  );
}

/**
 * Formats a byte count for the oversized notice.
 *
 * @param sizeBytes - Known size in bytes, or null when unknown.
 * @returns A compact size label.
 */
function formatBytes(sizeBytes: number | null): string {
  if (sizeBytes === null || !Number.isFinite(sizeBytes) || sizeBytes < 0) {
    return "unknown size";
  }

  if (sizeBytes >= BYTES_PER_MEGABYTE) {
    return `${(sizeBytes / BYTES_PER_MEGABYTE).toFixed(1)} MB`;
  }

  if (sizeBytes >= BYTES_PER_KILOBYTE) {
    return `${(sizeBytes / BYTES_PER_KILOBYTE).toFixed(1)} KB`;
  }

  return `${sizeBytes} B`;
}
