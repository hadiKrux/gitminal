import type { ScrollBoxRenderable } from "@opentui/core";
import { SyntaxStyle, TextAttributes } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { useRepository } from "@/app/hooks/useRepository";
import { useScrollContentWidth } from "@/app/hooks/useScrollContentWidth";
import type { CommitDetailsRecord, CommitStatsRecord } from "@/domain/git/git.types";
import type { CommitRefGroups } from "@/domain/repository/repository.types";
import { CommitMetaRow } from "@/features/commit-details/CommitMetaRow";
import type { RefBadgeView } from "@/features/commit-details/commit-details.types";
import { ParentRef } from "@/features/commit-details/ParentRef";
import {
  COMMIT_DETAILS_BOUNDED_MISS,
  COMMIT_DETAILS_ERROR_MESSAGE,
  COMMIT_DETAILS_LOADING_LABEL,
  COMMIT_DETAILS_LOADING_PARENT_LABEL,
  COMMIT_DETAILS_MESSAGE_TOGGLE_ID,
  COMMIT_DETAILS_NO_PARENTS,
  COMMIT_DETAILS_NO_REFS,
  COMMIT_DETAILS_READ_ONLY,
  COMMIT_DETAILS_RETRY_ID,
  COMMIT_DETAILS_SHOW_LESS,
  COMMIT_DETAILS_SHOW_MORE,
  COMMIT_DETAILS_STATS_TRUNCATED,
  COMMIT_MESSAGE_COLLAPSED_LINES,
  COMMIT_PARENT_LIST_MAX_ROWS,
  COMMIT_REF_BADGE_CAP,
  COMMIT_REF_BADGE_MAX_LENGTH,
  COMMIT_SHORT_OID_LENGTH,
  useCommitDetails,
} from "@/features/commit-details/useCommitDetails";
import { truncateText } from "@/lib/text";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { ErrorState } from "@/ui/ErrorState";
import { LoadingRow } from "@/ui/LoadingRow";
import { Panel } from "@/ui/Panel";
import { ScrollableList } from "@/ui/ScrollableList";

/**
 * Renders the Commit details pane for the selected commit.
 *
 * The component is composed by `AppShellHost` when `RepositoryProvider.selection.kind` is `commit`.
 * It owns the `right-pane` region frame and its own `Panel`, titled `Commit` plus the short hash. When
 * the selection is not a commit it renders nothing and mounts no details state, so the right pane can
 * switch between the composer, stash details, worktree details, and commit details from
 * `selection.kind` alone.
 *
 * @returns The details pane, or null when the selection is not a commit.
 */
export function CommitDetails(): ReactNode {
  const repository = useRepository();

  if (repository.selection.kind !== "commit") {
    return null;
  }

  return <CommitDetailsBody />;
}

/**
 * Renders the loaded pane body.
 *
 * The previous commit stays visible while a newer read runs, and a settled failure clears it so the
 * error state never shows another commit's hashes beside the new selection. The graph selection is
 * never lost to a transient read error. Loading, error, empty, root, no-refs, and truncated states
 * all print text, and no mutation control exists because the pane is read-only.
 *
 * @returns The panel body.
 */
function CommitDetailsBody(): ReactNode {
  const pane = useCommitDetails();
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const { width, onSizeChange } = useScrollContentWidth(scrollRef);

  return (
    <Panel
      {...pane.region.regionProps}
      focused={pane.region.focused}
      title={pane.title}
      flexGrow={1}
      flexBasis={0}
      minHeight={4}
    >
      <box flexDirection="column" flexGrow={1} minHeight={0}>
        {pane.isLoading ? <LoadingRow label={COMMIT_DETAILS_LOADING_LABEL} /> : null}
        {pane.error === null ? null : (
          <ErrorState
            message={COMMIT_DETAILS_ERROR_MESSAGE}
            details={pane.error}
            onRetry={pane.retry}
            retryId={COMMIT_DETAILS_RETRY_ID}
          />
        )}
        <ScrollableList
          id="commit-details-body"
          scrollRef={scrollRef}
          onSizeChange={onSizeChange}
          viewportCulling
        >
          {pane.details === null ? (
            <EmptyState message="No commit details loaded" />
          ) : (
            <CommitDetailsContent pane={pane} width={width} />
          )}
        </ScrollableList>
      </box>
    </Panel>
  );
}

/**
 * Renders every field of one loaded commit.
 *
 * @param props - Details handle with a non-null commit and the measured pane width.
 * @returns The field stack.
 */
function CommitDetailsContent(props: {
  readonly pane: ReturnType<typeof useCommitDetails>;
  readonly width: number;
}): ReactNode {
  const pane = props.pane;
  const details = pane.details;
  const tokens = useTokens();
  const syntaxStyle = useCodeSyntaxStyle();

  if (details === null) {
    return null;
  }

  const stats = pane.stats;

  return (
    <box flexDirection="column" flexShrink={0}>
      <box flexDirection="row" flexShrink={0} paddingLeft={1} gap={2}>
        <text id="commit-short-hash" fg={tokens.accent} attributes={TextAttributes.BOLD}>
          {details.shortOid}
        </text>
        <text fg={tokens.muted}>{COMMIT_DETAILS_READ_ONLY}</text>
      </box>
      {stats === null ? null : <CommitStatsRow stats={stats} />}
      <CommitMessageBlock
        message={details.message}
        expanded={pane.messageExpanded}
        onToggle={pane.toggleMessage}
        style={syntaxStyle}
      />
      <CommitMetaRow
        kind="author"
        name={details.authorName}
        email={details.authorEmail}
        date={details.authorDate}
        width={props.width}
      />
      {pane.committerDiffers ? (
        <CommitMetaRow
          kind="committer"
          name={details.committerName}
          email={details.committerEmail}
          date={details.committerDate}
          width={props.width}
          differs
        />
      ) : null}
      <CommitRefsRow refs={pane.refs} />
      <CommitParents
        details={details}
        parentIndex={pane.parentIndex}
        focused={pane.region.focused}
        isLoadingParent={pane.isLoadingParent}
        boundedMiss={pane.boundedMiss}
        onParentMouseDown={pane.handleParentMouseDown}
      />
      <CommitHashBlock
        id="commit-full-hash"
        label="Full hash"
        value={details.oid}
        style={syntaxStyle}
      />
      <CommitHashBlock
        id="commit-tree-hash"
        label="Tree hash"
        value={details.treeOid}
        style={syntaxStyle}
      />
    </box>
  );
}

/**
 * Renders one labeled monospace hash block.
 *
 * @param props - Renderable id, label, hash value, and shared syntax style.
 * @returns The labeled code block.
 */
function CommitHashBlock(props: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly style: SyntaxStyle;
}): ReactNode {
  const tokens = useTokens();

  return (
    <box flexDirection="column" flexShrink={0} paddingLeft={1}>
      <text fg={tokens.muted}>{props.label}</text>
      <code id={props.id} content={props.value} fg={tokens.text} syntaxStyle={props.style} />
    </box>
  );
}

/**
 * Renders the ref badges that point at the commit.
 *
 * Badges appear in tag, local-branch, remote-branch order. Each label is truncated to the documented
 * badge budget, and labels beyond the badge cap are replaced by one overflow marker, so a commit
 * decorated with many refs never grows without bound.
 *
 * @param props - Grouped refs from the selector.
 * @returns The refs row, including the `No refs` state.
 */
function CommitRefsRow(props: { readonly refs: CommitRefGroups }): ReactNode {
  const tokens = useTokens();
  const badges = buildRefBadges(props.refs);

  return (
    <box flexDirection="column" flexShrink={0} paddingLeft={1}>
      <text fg={tokens.muted}>Refs</text>
      {badges.visible.length === 0 ? (
        <text id="commit-refs-empty" fg={tokens.muted}>
          {COMMIT_DETAILS_NO_REFS}
        </text>
      ) : (
        <text id="commit-refs" wrapMode="word">
          {badges.visible.map((badge) => (
            <span key={badge.key} fg={readRefColor(badge.kind, tokens)}>
              {`[${badge.label}] `}
            </span>
          ))}
          {badges.overflow > 0 ? (
            <span fg={tokens.dim}>{`${ICONS.badgeOverflow}${badges.overflow}`}</span>
          ) : null}
        </text>
      )}
    </box>
  );
}

/**
 * Renders the selectable parent list, its loading row, and the bounded-miss message.
 *
 * A root commit shows `No parents` instead of an empty list. The list is bounded by the documented
 * visible-row count and virtualized with `viewportCulling`. Short hashes are computed from the full
 * parent OIDs because the graph window that could supply a subject belongs to another feature.
 *
 * @param props - Details record, cursor position, loading state, and row handler.
 * @returns The parents section.
 */
function CommitParents(props: {
  readonly details: CommitDetailsRecord;
  readonly parentIndex: number;
  readonly focused: boolean;
  readonly isLoadingParent: boolean;
  readonly boundedMiss: boolean;
  readonly onParentMouseDown: (index: number) => void;
}): ReactNode {
  const tokens = useTokens();
  const parents = props.details.parents;

  return (
    <box flexDirection="column" flexShrink={0} paddingLeft={1}>
      <text fg={tokens.muted}>Parents</text>
      {props.isLoadingParent ? <LoadingRow label={COMMIT_DETAILS_LOADING_PARENT_LABEL} /> : null}
      {props.boundedMiss ? (
        <text fg={tokens.warning} wrapMode="word">
          {`${ICONS.warning} ${COMMIT_DETAILS_BOUNDED_MISS}`}
        </text>
      ) : null}
      {parents.length === 0 ? (
        <text id="commit-parents-empty" fg={tokens.muted}>
          {COMMIT_DETAILS_NO_PARENTS}
        </text>
      ) : (
        <ScrollableList
          id="commit-parents"
          height={Math.min(parents.length, COMMIT_PARENT_LIST_MAX_ROWS)}
          flexGrow={0}
          viewportCulling
        >
          {parents.map((oid, index) => (
            <ParentRef
              key={oid}
              oid={oid}
              shortOid={oid.slice(0, COMMIT_SHORT_OID_LENGTH)}
              subject={null}
              selected={index === props.parentIndex}
              focused={props.focused}
              disabled={props.isLoadingParent}
              disabledReason={
                props.isLoadingParent ? COMMIT_DETAILS_LOADING_PARENT_LABEL : undefined
              }
              onMouseDown={() => {
                props.onParentMouseDown(index);
              }}
            />
          ))}
        </ScrollableList>
      )}
    </box>
  );
}

/**
 * Renders the summed change stats and the binary and truncation notes.
 *
 * @param props - Summed stats of the commit.
 * @returns The stats section.
 */
function CommitStatsRow(props: { readonly stats: CommitStatsRecord }): ReactNode {
  const tokens = useTokens();
  const stats = props.stats;

  return (
    <box flexDirection="column" flexShrink={0} paddingLeft={1}>
      <text id="commit-stats" fg={tokens.text}>
        {`${stats.filesChanged} files changed +${stats.insertions} -${stats.deletions}`}
      </text>
      {stats.binaryFiles === 0 ? null : (
        <text fg={tokens.muted}>{`${stats.binaryFiles} binary`}</text>
      )}
      {stats.truncated ? (
        <text id="commit-stats-truncated" fg={tokens.dim}>
          {COMMIT_DETAILS_STATS_TRUNCATED}
        </text>
      ) : null}
    </box>
  );
}

/**
 * Renders the commit message body.
 *
 * The body is collapsed to the documented line count and rendered in a `<code>` block inside the
 * pane scrollbox. A button toggles between the collapsed and full body. The pane registers only
 * parent navigation actions, so the toggle is a mouse-activated presentation control with its label
 * always visible.
 *
 * @param props - Message, expansion flag, toggle callback, and shared syntax style.
 * @returns The message section.
 */
function CommitMessageBlock(props: {
  readonly message: string;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly style: SyntaxStyle;
}): ReactNode {
  const tokens = useTokens();
  const lines = props.message.split("\n");
  const collapsible = lines.length > COMMIT_MESSAGE_COLLAPSED_LINES;
  const visible = props.expanded
    ? props.message
    : lines.slice(0, COMMIT_MESSAGE_COLLAPSED_LINES).join("\n");
  const hidden = Math.max(0, lines.length - COMMIT_MESSAGE_COLLAPSED_LINES);

  return (
    <box flexDirection="column" flexShrink={0} paddingLeft={1}>
      <text fg={tokens.muted}>Message</text>
      <code
        id="commit-message"
        content={visible}
        fg={tokens.text}
        syntaxStyle={props.style}
        wrapMode="word"
      />
      {collapsible ? (
        <Button
          id={COMMIT_DETAILS_MESSAGE_TOGGLE_ID}
          label={
            props.expanded ? COMMIT_DETAILS_SHOW_LESS : `${COMMIT_DETAILS_SHOW_MORE} (${hidden})`
          }
          onPress={props.onToggle}
        />
      ) : null}
    </box>
  );
}

/**
 * Builds the bounded badge window for one refs row.
 *
 * @param refs - Grouped refs in render order.
 * @returns The visible badges and the overflow count.
 */
function buildRefBadges(refs: CommitRefGroups): {
  readonly visible: readonly RefBadgeView[];
  readonly overflow: number;
} {
  const all: RefBadgeView[] = [
    ...refs.tags.map((label): RefBadgeView => ({ key: `tag-${label}`, label, kind: "tag" })),
    ...refs.local.map((label): RefBadgeView => ({ key: `local-${label}`, label, kind: "local" })),
    ...refs.remote.map(
      (label): RefBadgeView => ({ key: `remote-${label}`, label, kind: "remote" }),
    ),
  ];
  const visible = all.slice(0, COMMIT_REF_BADGE_CAP).map((badge) => ({
    ...badge,
    label: truncateText(badge.label, COMMIT_REF_BADGE_MAX_LENGTH, ICONS.ellipsis),
  }));

  return { visible, overflow: all.length - visible.length };
}

/**
 * Reads the token color of one badge group.
 *
 * @param kind - Badge group.
 * @param tokens - Resolved theme tokens.
 * @returns The color for that group.
 */
function readRefColor(kind: RefBadgeView["kind"], tokens: ReturnType<typeof useTokens>): string {
  if (kind === "tag") {
    return tokens.tag;
  }

  return kind === "local" ? tokens.branchLocal : tokens.branchRemote;
}

/**
 * Creates and owns the syntax style used by the code blocks.
 *
 * `CodeRenderable` requires a syntax style bound to the renderer. One `default` style keeps the
 * hashes and message body in the `text` token, and the style is released when its renderer or the
 * token changes, so a theme switch cannot leak the previous style.
 *
 * @returns The syntax style bound to the active renderer and theme.
 */
function useCodeSyntaxStyle(): SyntaxStyle {
  const renderer = useRenderer();
  const tokens = useTokens();
  const style = useMemo(
    () => SyntaxStyle.fromStyles({ default: { fg: tokens.text } }, renderer.nativeScene),
    [renderer, tokens.text],
  );

  useEffect(
    () => () => {
      style.destroy();
    },
    [style],
  );

  return style;
}
