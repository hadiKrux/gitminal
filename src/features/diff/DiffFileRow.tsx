import type { ReactNode } from "react";
import type { DiffFileView } from "@/domain/repository/repository.types";
import type { DiffActionView } from "@/features/diff/diffPanel.types";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import { Button } from "@/ui/Button";
import { ListRow } from "@/ui/ListRow";
import { TruncatedText } from "@/ui/TruncatedText";

/** Cells reserved for the `ListRow` selection marker. */
const ROW_MARKER_WIDTH = 1;

/** Cells reserved for the expand indicator and the ` M ` status letters. */
const ROW_STATE_WIDTH = 4;

/** Minimum path budget kept even on a very narrow panel. */
const MIN_PATH_BUDGET = 4;

/** Status letter glyph per row status. */
const STATUS_GLYPHS = Object.freeze({
  M: ICONS.modified,
  A: ICONS.added,
  D: ICONS.deleted,
  R: ICONS.renamed,
  C: ICONS.copied,
  U: ICONS.conflicted,
  "?": ICONS.untracked,
});

/**
 * Renders one changed-file row.
 *
 * The row shows the expand indicator, the strongest status letter, the repository-relative path, and
 * the add and remove counts once the diff has been read. A rename renders as `old -> new`. Paths
 * truncate through `@/lib/text.ts` with the measured row width, so the status letter, the expand
 * indicator, and the counts survive a narrow panel. Per-file actions render under the row; a disabled
 * action stays visible with its text reason. The row itself is never focusable: the region frame owns
 * focus and `ListRow` carries the selection marker and background.
 *
 * @param props - Row model, measured row width, selection and focus flags, expansion, counts, and
 * inline actions.
 * @returns The composed file row.
 */
export function DiffFileRow(props: {
  readonly file: DiffFileView;
  readonly width: number;
  readonly selected: boolean;
  readonly focused: boolean;
  readonly expanded: boolean;
  readonly counts: { readonly add: number; readonly remove: number } | null;
  readonly actions: readonly DiffActionView[];
  readonly onToggle: () => void;
  readonly onMouseDown: () => void;
}): ReactNode {
  const tokens = useTokens();
  const path = readPathLabel(props.file);
  const counts = readCountsLabel(props.counts);
  const chrome = ROW_MARKER_WIDTH + ROW_STATE_WIDTH + (counts.length === 0 ? 0 : counts.length + 1);
  const budget = Math.max(MIN_PATH_BUDGET, Math.floor(props.width) - chrome);

  return (
    <ListRow
      id={props.file.id}
      selected={props.selected}
      focused={props.focused}
      onMouseDown={props.onMouseDown}
    >
      <box flexDirection="row" flexShrink={0} overflow="hidden">
        <text fg={tokens.muted} wrapMode="none" flexShrink={0}>
          {props.expanded ? ICONS.expanded : ICONS.collapsed}
        </text>
        <text fg={readStatusColor(props.file, tokens)} wrapMode="none" flexShrink={0}>
          {` ${STATUS_GLYPHS[props.file.statusLetter]} `}
        </text>
        <TruncatedText text={path} maxWidth={budget} fg={tokens.text} />
        {counts.length === 0 ? null : (
          <text fg={tokens.muted} wrapMode="none" flexShrink={0}>
            {` ${counts}`}
          </text>
        )}
      </box>
      {props.actions.length === 0 ? null : (
        <box flexDirection="row" flexShrink={0} gap={1} paddingLeft={3}>
          {props.actions.map((action) => (
            <Button
              key={action.id}
              id={`${props.file.id}::${action.id}`}
              label={action.label}
              disabled={action.disabled}
              reason={action.reason}
              onPress={action.onPress}
            />
          ))}
        </box>
      )}
    </ListRow>
  );
}

/**
 * Builds the visible path label.
 *
 * @param file - File row model.
 * @returns `old -> new` for a rename or copy, otherwise the plain path.
 */
function readPathLabel(file: DiffFileView): string {
  return file.oldPath === null || file.oldPath === file.path
    ? file.path
    : `${file.oldPath} -> ${file.path}`;
}

/**
 * Builds the add and remove count label.
 *
 * @param counts - Line counts, or null before the diff has been read.
 * @returns The compact counts, or an empty string when unavailable.
 */
function readCountsLabel(counts: { readonly add: number; readonly remove: number } | null): string {
  return counts === null ? "" : `${ICONS.diffAdd}${counts.add} ${ICONS.diffRemove}${counts.remove}`;
}

/**
 * Reads the color token for a row status.
 *
 * @param file - File row model.
 * @param tokens - Resolved theme tokens.
 * @returns The added, removed, or warning token.
 */
function readStatusColor(file: DiffFileView, tokens: ReturnType<typeof useTokens>): string {
  if (file.conflicted) {
    return tokens.warning;
  }

  if (file.statusLetter === "A" || file.statusLetter === "?") {
    return tokens.diffAdd;
  }

  return file.statusLetter === "D" ? tokens.diffRemove : tokens.muted;
}
