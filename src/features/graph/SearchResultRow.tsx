import type { ReactNode } from "react";
import { formatCommitDate, shortenAuthor, shortenOid } from "@/features/graph/graph.format";
import { classifyDecorations, fitRefBadges, flattenRefBadges } from "@/features/graph/graph.refs";
import { searchResultRowId } from "@/features/graph/graph.rows";
import { highlightTerms } from "@/features/graph/graph.snippet";
import type { SearchResultView } from "@/features/graph/graph.types";
import { truncateText } from "@/lib/text";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import { ListRow } from "@/ui/ListRow";

/** Cells reserved for the `ListRow` selection marker. */
const ROW_MARKER_WIDTH = 1;

/**
 * Renders one flat commit search result.
 *
 * The row hides graph lanes and the Pending Changes row. It shows the short hash, the subject with
 * matched terms highlighted, the affected file count, ref badges, author, and date, plus one body
 * snippet when the match came from the body. Matching terms remain readable without color because
 * the snippet keeps the literal text around them. The row carries the stable
 * `graph-search-row:<oid>` renderable id, so the search result cursor is revealed through the same
 * scrollbox path as a graph row.
 *
 * @param props - Prepared result, the measured row width, parsed search terms, selection and focus
 * flags, and the mouse handler.
 * @returns The composed search result row.
 */
export function SearchResultRow(props: {
  readonly view: SearchResultView;
  readonly width: number;
  readonly terms: readonly string[];
  readonly selected: boolean;
  readonly focused: boolean;
  readonly onMouseDown?: () => void;
}): ReactNode {
  const tokens = useTokens();
  const width = Math.max(1, Math.floor(props.width) - ROW_MARKER_WIDTH);
  const shortOid = shortenOid(props.view.id);
  const fileCount = String(props.view.row.fileCount);
  const subjectBudget = Math.max(0, width - shortOid.length - fileCount.length - 2);
  const subject = truncateText(props.view.row.subject, subjectBudget, ICONS.ellipsis);
  const groups = classifyDecorations(props.view.row.decorations);
  const badges = flattenRefBadges(groups);
  const author = shortenAuthor(props.view.row.authorName);
  const date = formatCommitDate(props.view.row.committerTimestamp, Date.now());
  const metadataIndent = shortOid.length + 1;
  const badgeBudget = Math.max(0, width - metadataIndent - author.length - date.length - 2);
  const fitted = fitRefBadges(badges, badgeBudget);

  return (
    <ListRow
      id={searchResultRowId(props.view.id)}
      selected={props.selected}
      focused={props.focused}
      onMouseDown={props.onMouseDown}
    >
      <box flexDirection="column" flexGrow={1} flexShrink={1}>
        <box flexDirection="row" flexShrink={0}>
          <text fg={tokens.muted} wrapMode="none" flexShrink={0}>
            {shortOid}
          </text>
          <text wrapMode="none" flexShrink={0}>
            {" "}
          </text>
          <text wrapMode="none" flexShrink={1}>
            <HighlightedSpans
              text={subject}
              terms={props.terms}
              fg={tokens.text}
              matchFg={tokens.accent}
            />
          </text>
          <box flexGrow={1} flexShrink={0} />
          <text fg={tokens.muted} wrapMode="none" flexShrink={0}>
            {fileCount}
          </text>
        </box>
        <box flexDirection="row" flexShrink={0} paddingLeft={shortOid.length + 1}>
          {fitted.visible.length === 0 && fitted.overflow === 0 ? null : (
            <text wrapMode="none" flexShrink={1}>
              {fitted.visible.map((badge, index) => (
                <span
                  key={`${badge.kind}:${badge.label}`}
                  fg={
                    badge.kind === "tag"
                      ? tokens.tag
                      : badge.kind === "local"
                        ? tokens.branchLocal
                        : tokens.branchRemote
                  }
                >
                  {`${index === 0 ? "" : " "}[${badge.label}]`}
                </span>
              ))}
              {fitted.overflow === 0 ? null : (
                <span fg={tokens.dim}>
                  {`${fitted.visible.length === 0 ? "" : " "}${ICONS.badgeOverflow}${fitted.overflow}`}
                </span>
              )}
            </text>
          )}
          <text fg={tokens.muted} wrapMode="none" flexShrink={1}>
            {`${fitted.visible.length > 0 || fitted.overflow > 0 ? " " : ""}${author}`}
          </text>
          <box flexGrow={1} flexShrink={0} />
          <text fg={tokens.dim} wrapMode="none" flexShrink={0}>
            {date}
          </text>
        </box>
        {props.view.snippet === null ? null : (
          <box flexDirection="row" flexShrink={0} paddingLeft={shortOid.length + 1}>
            <text wrapMode="none" flexShrink={1}>
              {props.view.snippet.leadingEllipsis ? (
                <span fg={tokens.dim}>{`${ICONS.ellipsis} `}</span>
              ) : null}
              <HighlightedSpans
                text={truncateText(
                  props.view.snippet.text,
                  Math.max(0, width - metadataIndent),
                  ICONS.ellipsis,
                )}
                terms={props.terms}
                fg={tokens.muted}
                matchFg={tokens.accent}
              />
              {props.view.snippet.trailingEllipsis ? (
                <span fg={tokens.dim}>{` ${ICONS.ellipsis}`}</span>
              ) : null}
            </text>
          </box>
        )}
      </box>
    </ListRow>
  );
}

/**
 * Renders the inline spans of one highlighted string.
 *
 * @param props - Text, search terms, base color, and match color.
 * @returns Ordered spans for a surrounding `<text>` element.
 */
function HighlightedSpans(props: {
  readonly text: string;
  readonly terms: readonly string[];
  readonly fg: string;
  readonly matchFg: string;
}): ReactNode {
  const segments = highlightTerms(props.text, props.terms).map((segment, index) => ({
    ...segment,
    key: `segment-${index}-${segment.matched ? "m" : "p"}`,
  }));

  return segments.map((segment) => (
    <span key={segment.key} fg={segment.matched ? props.matchFg : props.fg}>
      {segment.text}
    </span>
  ));
}
