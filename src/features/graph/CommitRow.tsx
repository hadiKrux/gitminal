import { type ReactNode, useMemo } from "react";
import { GraphLanes } from "@/features/graph/GraphLanes";
import { formatCommitDate, shortenAuthor } from "@/features/graph/graph.format";
import { classifyDecorations, fitRefBadges, flattenRefBadges } from "@/features/graph/graph.refs";
import type { CommitRowView, GraphBadgeTokens, GraphRefBadge } from "@/features/graph/graph.types";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import { ListRow } from "@/ui/ListRow";
import { TruncatedText } from "@/ui/TruncatedText";

/** Cells reserved for the `ListRow` selection marker. */
const ROW_MARKER_WIDTH = 1;

/** Smallest useful metadata allowance before the date is dropped from a tagged row. */
const MIN_TAGGED_BADGE_BUDGET = 6;

/**
 * Builds the stable renderable id of one commit row.
 *
 * @param oid - Full commit OID.
 * @returns The row id used by tests and the scroll container.
 */
export function commitRowId(oid: string): string {
  return `graph-row:${oid}`;
}

/**
 * Renders one commit row with lanes, subject, ref badges, file count, author, and date.
 *
 * The lane prefix and node come from the page-level `assignGraphLanes` pass. The subject is the only
 * value that shortens on the first line, so the right-aligned file count never moves. The metadata
 * line keeps tag badges ahead of the author and date; when a tagged row is tight, the date is
 * omitted before badge priority is lost.
 *
 * @param props - Prepared commit view, the measured row width, selection and focus flags, and the
 * mouse handler.
 * @returns The composed commit row.
 */
export function CommitRow(props: {
  readonly view: CommitRowView;
  readonly width: number;
  readonly selected: boolean;
  readonly focused: boolean;
  readonly onMouseDown?: () => void;
}): ReactNode {
  const tokens = useTokens();
  const width = Math.max(1, Math.floor(props.width) - ROW_MARKER_WIDTH);
  const laneWidth = props.view.lanes.length;
  const fileCount = String(props.view.row.fileCount);
  const subjectBudget = Math.max(0, width - laneWidth - fileCount.length - 2);
  const metadata = useMetadataLine(props.view, width, laneWidth + 1);

  return (
    <ListRow
      id={commitRowId(props.view.id)}
      selected={props.selected}
      focused={props.focused}
      onMouseDown={props.onMouseDown}
    >
      <box flexDirection="column" flexGrow={1} flexShrink={1}>
        <box flexDirection="row" flexShrink={0}>
          <GraphLanePrefix view={props.view} />
          <text wrapMode="none" flexShrink={0}>
            {" "}
          </text>
          <TruncatedText text={props.view.row.subject} maxWidth={subjectBudget} />
          <box flexGrow={1} flexShrink={0} />
          <text fg={tokens.muted} wrapMode="none" flexShrink={0}>
            {fileCount}
          </text>
        </box>
        <box flexDirection="row" flexShrink={0} paddingLeft={metadata.indent}>
          <BadgeText badges={metadata.badges.visible} overflow={metadata.badges.overflow} />
          <text fg={tokens.muted} wrapMode="none" flexShrink={1}>
            {`${metadata.badges.visible.length > 0 ? " " : ""}${metadata.author}`}
          </text>
          <box flexGrow={1} flexShrink={0} />
          {metadata.date === null ? null : (
            <text fg={tokens.dim} wrapMode="none" flexShrink={0}>
              {metadata.date}
            </text>
          )}
        </box>
      </box>
    </ListRow>
  );
}

/**
 * Renders the lane prefix for one prepared row.
 *
 * @param props - Prepared row.
 * @returns The lane prefix.
 */
function GraphLanePrefix(props: { readonly view: CommitRowView }): ReactNode {
  return <GraphLanes cells={props.view.lanes} nodeColumn={props.view.nodeColumn} />;
}

/**
 * Renders the visible ref badges plus the overflow marker.
 *
 * @param props - Visible badges and omitted count.
 * @returns Inline badge spans, or null when the row has no badges.
 */
function BadgeText(props: {
  readonly badges: readonly GraphRefBadge[];
  readonly overflow: number;
}): ReactNode {
  const tokens = useTokens();

  if (props.badges.length === 0 && props.overflow === 0) {
    return null;
  }

  return (
    <text wrapMode="none" flexShrink={1}>
      {props.badges.map((badge, index) => (
        <span
          // Badge labels are unique inside the flattened list.
          key={`${badge.kind}:${badge.label}`}
          fg={readBadgeColor(badge.kind, tokens)}
        >
          {`${index === 0 ? "" : " "}[${badge.label}]`}
        </span>
      ))}
      {props.overflow === 0 ? null : (
        <span fg={tokens.dim}>
          {`${props.badges.length === 0 ? "" : " "}${ICONS.badgeOverflow}${props.overflow}`}
        </span>
      )}
    </text>
  );
}

/**
 * Resolves the token for one badge group.
 *
 * @param kind - Badge group.
 * @param tokens - Active theme tokens.
 * @returns The resolved color.
 */
function readBadgeColor(kind: GraphRefBadge["kind"], tokens: GraphBadgeTokens): string {
  switch (kind) {
    case "tag":
      return tokens.tag;
    case "local":
      return tokens.branchLocal;
    case "remote":
      return tokens.branchRemote;
  }
}

/**
 * Builds the metadata-line values for one row.
 *
 * @param view - Prepared commit view.
 * @param width - Available row width.
 * @param indent - Lane-column indentation.
 * @returns The indentation, faded badges, author, and optional date.
 */
function useMetadataLine(view: CommitRowView, width: number, indent: number) {
  return useMemo(() => {
    const groups = classifyDecorations(view.row.decorations);
    const badges = flattenRefBadges(groups);
    const author = shortenAuthor(view.row.authorName);
    const date = formatCommitDate(view.row.committerTimestamp, Date.now());
    const available = Math.max(0, width - indent - author.length - 1);
    const withDate = available - date.length - 2;

    if (withDate >= MIN_TAGGED_BADGE_BUDGET || groups.tags.length === 0) {
      return {
        indent,
        author,
        date: withDate >= MIN_TAGGED_BADGE_BUDGET ? date : null,
        badges: fitRefBadges(badges, Math.max(0, withDate)),
      };
    }

    return {
      indent,
      author,
      date: null,
      badges: fitRefBadges(badges, Math.max(0, available - 1)),
    };
  }, [indent, view, width]);
}
