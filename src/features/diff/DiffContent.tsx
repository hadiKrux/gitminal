import { pathToFiletype } from "@opentui/core";
import type { ReactNode } from "react";
import type { DiffLoadState } from "@/domain/diff/diff.types";
import { readDiffContentWidth } from "@/features/diff/diffContent.layout";
import { ICONS } from "@/theme/icons";
import { useSyntaxStyle } from "@/theme/useSyntaxStyle";
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
 * gutter, and theme-mapped added and removed backgrounds and signs. Each segment also receives the
 * filetype derived from the path and the theme-owned syntax style, so the built-in TypeScript,
 * JavaScript, JSX, Markdown, and Zig grammars plus the vendored Bash, CSS, Go, HTML, Java, JSON,
 * PHP, Python, Rust, and YAML grammars are colored from theme tokens while any language without a
 * registered parser keeps the plain `text` color. A collapsed segment becomes a text marker,
 * because the renderer only ever receives complete unified patches. Binary, oversized,
 * metadata-only, empty, and truncated files each render their own notice with text. Loading and
 * failure states stay inline so the row stays expanded and Retry re-runs only this file.
 *
 * Each `<diff>` receives an explicit width from `readDiffContentWidth`: the measured panel width
 * while its longest rendered line fits, and the natural line width plus the line-number gutter once
 * a line is longer. The installed renderable creates its code view with `width: "100%"` and
 * `wrapMode: "none"`, so without that width it clips long lines instead of widening the scroll
 * content, and `scrollX` alone could never reveal them. Notices, loading rows, error states, and
 * empty states stay inside the measured width so they never stretch the scroll content to their own
 * text length.
 *
 * @param props - Target path, measured width, load state, and the Retry callback.
 * @returns The composed diff content.
 */
export function DiffContent(props: {
  readonly path: string;
  readonly width: number;
  readonly state: DiffLoadState | undefined;
  readonly onRetry: () => void;
}): ReactNode {
  const tokens = useTokens();
  const syntaxStyle = useSyntaxStyle();
  const state = props.state;
  const filetype = pathToFiletype(props.path);

  if (state === undefined || state.status === "idle" || state.status === "loading") {
    return (
      <box maxWidth={props.width} flexShrink={0}>
        <LoadingRow label={DIFF_LOADING_LABEL} />
      </box>
    );
  }

  if (state.status === "error") {
    return (
      <box maxWidth={props.width} flexShrink={0}>
        <ErrorState
          message={`Could not read diff for ${props.path}`}
          details={state.message ?? undefined}
          onRetry={props.onRetry}
        />
      </box>
    );
  }

  if (state.status === "binary") {
    return (
      <box maxWidth={props.width} flexShrink={0}>
        <text fg={tokens.muted} wrapMode="word">
          {`${ICONS.info} ${DIFF_BINARY_NOTICE}`}
        </text>
      </box>
    );
  }

  if (state.status === "oversized") {
    return (
      <box maxWidth={props.width} flexShrink={0}>
        <text fg={tokens.muted} wrapMode="word">
          {`${ICONS.info} ${DIFF_OVERSIZED_NOTICE} (${formatBytes(state.sizeBytes)})`}
        </text>
      </box>
    );
  }

  return (
    <box flexDirection="column" flexShrink={0}>
      {state.file?.conflict === true ? (
        <box maxWidth={props.width} flexShrink={0}>
          <text fg={tokens.warning} wrapMode="word">
            {`${ICONS.warning} ${DIFF_CONFLICT_NOTICE}`}
          </text>
        </box>
      ) : null}
      {state.file?.modeOnly === true ? (
        <box maxWidth={props.width} flexShrink={0} flexDirection="column">
          <text fg={tokens.muted} wrapMode="word">
            {`${ICONS.info} ${DIFF_METADATA_ONLY_NOTICE}`}
          </text>
          {state.file.headerLines.map((line) => (
            <text key={line} fg={tokens.muted} wrapMode="none">
              {line}
            </text>
          ))}
        </box>
      ) : null}
      {state.segments.map((segment) =>
        segment.kind === "collapsed" ? (
          <box
            key={`collapsed:${segment.oldStart}:${segment.newStart}:${segment.count}`}
            maxWidth={props.width}
            flexShrink={0}
          >
            <text fg={tokens.diffContext} wrapMode="none">
              {`${segment.count} unchanged lines`}
            </text>
          </box>
        ) : (
          <diff
            key={`diff:${segment.hunkIndex}:${segment.oldStart}:${segment.newStart}`}
            diff={segment.text}
            width={readDiffContentWidth(segment.text, props.width)}
            view="unified"
            showLineNumbers
            filetype={filetype}
            syntaxStyle={syntaxStyle}
            fg={tokens.text}
            addedBg={tokens.diffAddBackground}
            removedBg={tokens.diffRemoveBackground}
            addedSignColor={tokens.diffAdd}
            removedSignColor={tokens.diffRemove}
          />
        ),
      )}
      {state.limits?.truncated === true ? (
        <box maxWidth={props.width} flexShrink={0}>
          <text fg={tokens.warning} wrapMode="word">
            {`${ICONS.warning} ${DIFF_TRUNCATION_PREFIX} ${state.limits.shownLines} of ${state.limits.totalLines} lines`}
          </text>
        </box>
      ) : null}
      {hasNothingToRender(state) ? (
        <box maxWidth={props.width} flexShrink={0}>
          <EmptyState message={DIFF_NO_CONTENT_NOTICE} />
        </box>
      ) : null}
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
