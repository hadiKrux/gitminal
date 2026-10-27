import type { ReactNode } from "react";
import type { DiffFileView, DiffSectionView } from "@/domain/repository/repository.types";
import type { DiffActionView } from "@/features/diff/diffPanel.types";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import { Button } from "@/ui/Button";
import { BUTTON_HORIZONTAL_PADDING } from "@/ui/Button.constants";
import { EmptyState } from "@/ui/EmptyState";
import { ListRow } from "@/ui/ListRow";

/** Cells used by the expand indicator, its gap, and the trailing gap. */
const HEADER_STATE_WIDTH = 3;

/** Indentation of an action row that does not share the title line. */
const ACTION_ROW_INDENT = 2;

/** Cells the button label and disabled reason use for their separating space. */
const ACTION_REASON_SEPARATOR_WIDTH = 1;

/**
 * Reads the rendered width of one action button, including its padding.
 *
 * A disabled button joins its label and reason with one space, and the button has one cell of
 * horizontal padding on each side, so the fit check must count both. Under-counting the separator
 * clips the last label or reason at the exact boundary instead of moving the actions to a second
 * line.
 *
 * @param action - Action view.
 * @returns Cells the button occupies when it is not focused.
 */
function readActionWidth(action: DiffActionView): number {
  const reasonWidth =
    action.disabled && action.reason !== undefined && action.reason.length > 0
      ? ACTION_REASON_SEPARATOR_WIDTH + action.reason.length
      : 0;

  return action.label.length + reasonWidth + BUTTON_HORIZONTAL_PADDING * 2;
}

/**
 * Reports whether the title and every bulk action fit on the header line.
 *
 * @param width - Measured section width.
 * @param title - Rendered `title (count)` text.
 * @param actions - Bulk actions in render order.
 * @returns True when one line holds the title, a one-cell spacer, and every action.
 */
function headerFitsOnOneLine(
  width: number,
  title: string,
  actions: readonly DiffActionView[],
): boolean {
  const available = Math.max(0, Math.floor(width) - HEADER_STATE_WIDTH);
  const actionsWidth =
    actions.reduce((total, action) => total + readActionWidth(action), 0) +
    Math.max(0, actions.length - 1);

  return title.length + 1 + actionsWidth <= available;
}

/**
 * Renders one diff section header and, when expanded, its file rows.
 *
 * The header carries the expand indicator, the F-11 title, the logical file count, and the section's
 * bulk actions. When the measured panel width cannot hold the title and every action on one line,
 * the actions move to a wrapping second line, so each label and its disabled reason stays reachable
 * at the documented 80x24 minimum. A disabled bulk action stays visible with its reason. The empty
 * message renders inside the expanded body so a collapsed empty section stays one header row. The
 * leading selection marker is suppressed so the expand indicator is the section's only leading
 * glyph. The component is presentational: the owning hook supplies the file renderer and every
 * callback.
 *
 * @param props - Section model, measured width, expansion, focus, bulk actions, empty text, and the
 * file renderer.
 * @returns The composed section.
 */
export function DiffSection(props: {
  readonly view: DiffSectionView;
  readonly width: number;
  readonly expanded: boolean;
  readonly selected: boolean;
  readonly focused: boolean;
  readonly emptyText: string;
  readonly bulkActions: readonly DiffActionView[];
  readonly onToggle: () => void;
  readonly onMouseDown: () => void;
  readonly renderFile: (file: DiffFileView) => ReactNode;
}): ReactNode {
  const tokens = useTokens();
  const title = `${props.view.title} (${props.view.files.length})`;
  const actionsInline = headerFitsOnOneLine(props.width, title, props.bulkActions);

  return (
    <box flexDirection="column" flexShrink={0}>
      <ListRow
        id={`section::${props.view.section}`}
        selected={props.selected}
        focused={props.focused}
        showMarker={false}
        onMouseDown={props.onMouseDown}
      >
        <box flexDirection="column" flexShrink={0}>
          <box flexDirection="row" flexShrink={0} gap={1} overflow="hidden">
            <text fg={tokens.muted} wrapMode="none" flexShrink={0}>
              {props.expanded ? ICONS.expanded : ICONS.collapsed}
            </text>
            <text fg={tokens.text} wrapMode="none" flexShrink={1}>
              {title}
            </text>
            {actionsInline ? (
              <ActionRow section={props.view.section} actions={props.bulkActions} />
            ) : null}
          </box>
          {actionsInline ? null : (
            <ActionRow section={props.view.section} actions={props.bulkActions} indented />
          )}
        </box>
      </ListRow>
      {props.expanded ? (
        <box flexDirection="column" flexShrink={0} paddingLeft={1}>
          {props.view.files.length === 0 ? <EmptyState message={props.emptyText} /> : null}
          {props.view.files.map((file) => props.renderFile(file))}
        </box>
      ) : null}
    </box>
  );
}

/**
 * Renders the bulk action buttons, wrapping when one line is not enough.
 *
 * @param props - Owning section, actions, and whether the row is indented under the title.
 * @returns The action row.
 */
function ActionRow(props: {
  readonly section: DiffSectionView["section"];
  readonly actions: readonly DiffActionView[];
  readonly indented?: boolean;
}): ReactNode {
  if (props.actions.length === 0) {
    return null;
  }

  return (
    <box
      flexDirection="row"
      flexWrap="wrap"
      flexShrink={0}
      gap={1}
      paddingLeft={props.indented === true ? ACTION_ROW_INDENT : 0}
    >
      {props.actions.map((action) => (
        <Button
          key={action.id}
          id={`section::${props.section}::${action.id}`}
          label={action.label}
          disabled={action.disabled}
          reason={action.reason}
          onPress={action.onPress}
        />
      ))}
    </box>
  );
}
