import { GRAPH_MAX_BADGE_LENGTH } from "@/features/graph/graph.constants";
import type { FittedRefBadges, GraphRefBadge, GraphRefGroups } from "@/features/graph/graph.types";
import { truncateText } from "@/lib/text";

/** Prefix of a fully decorated tag entry. */
const TAG_PREFIX = "tag: ";

/** Prefix of a fully decorated local branch. */
const LOCAL_BRANCH_PREFIX = "refs/heads/";

/** Prefix of a fully decorated remote-tracking branch. */
const REMOTE_BRANCH_PREFIX = "refs/remotes/";

/** Prefix of a fully decorated tag ref. */
const TAG_REF_PREFIX = "refs/tags/";

/** Separator git uses between a symbolic ref and its target. */
const SYMBOLIC_REF_SEPARATOR = " -> ";

/** Width of the brackets around one rendered badge. */
const BADGE_FRAME_WIDTH = 2;

/** One space separates two rendered badges. */
const BADGE_SEPARATOR_WIDTH = 1;

/**
 * Classifies the decoration entries of one commit into tag, local, and remote groups.
 *
 * Git's `%D` output mixes symbolic entries such as `HEAD -> refs/heads/main`, tags such as
 * `tag: refs/tags/v1`, and plain refs. The returned groups keep the documented order: tags first,
 * then local branches, then remote-tracking branches.
 *
 * @param decorations - Raw decoration entries from the parsed commit row.
 * @returns The grouped badge labels, de-duplicated inside each group.
 */
export function classifyDecorations(decorations: readonly string[]): GraphRefGroups {
  const tags = new Set<string>();
  const local = new Set<string>();
  const remote = new Set<string>();

  for (const decoration of decorations) {
    classifyDecoration(decoration, tags, local, remote);
  }

  return {
    tags: [...tags],
    local: [...local],
    remote: [...remote],
  };
}

/**
 * Flattens grouped ref labels into the display order.
 *
 * @param groups - Classified groups.
 * @returns One badge per label, tag badges first.
 */
export function flattenRefBadges(groups: GraphRefGroups): readonly GraphRefBadge[] {
  return [
    ...groups.tags.map((label) => ({ label, kind: "tag" as const })),
    ...groups.local.map((label) => ({ label, kind: "local" as const })),
    ...groups.remote.map((label) => ({ label, kind: "remote" as const })),
  ];
}

/**
 * Keeps the leading badges that fit and reports how many were omitted.
 *
 * The overflow marker is reserved before the last badge is kept, so the row always has room for
 * `+N` when something is hidden. A row too narrow for the marker shows no badges and counts every
 * badge as overflow.
 *
 * @param badges - Badges in display order.
 * @param maxWidth - Character budget for the rendered badges and separators.
 * @returns The visible badges and the omitted count.
 */
export function fitRefBadges(badges: readonly GraphRefBadge[], maxWidth: number): FittedRefBadges {
  if (badges.length === 0) {
    return { visible: [], overflow: 0 };
  }

  if (maxWidth <= 0) {
    return { visible: [], overflow: badges.length };
  }

  const visible: GraphRefBadge[] = [];
  let usedWidth = 0;

  for (const badge of badges) {
    const separatorWidth = visible.length === 0 ? 0 : BADGE_SEPARATOR_WIDTH;
    const badgeWidth = measureBadge(badge);

    if (usedWidth + separatorWidth + badgeWidth > maxWidth) {
      break;
    }

    usedWidth += separatorWidth + badgeWidth;
    visible.push(badge);
  }

  let overflow = badges.length - visible.length;

  if (overflow === 0) {
    return { visible, overflow };
  }

  while (
    visible.length > 0 &&
    usedWidth + BADGE_SEPARATOR_WIDTH + measureOverflow(overflow) > maxWidth
  ) {
    visible.pop();
    usedWidth = measureVisibleWidth(visible);
    overflow += 1;
  }

  if (measureOverflow(overflow) > maxWidth) {
    return { visible: [], overflow: badges.length };
  }

  return { visible, overflow };
}

/**
 * Adds one decoration entry to the matching group.
 *
 * @param decoration - Raw decoration entry.
 * @param tags - Tag label set.
 * @param local - Local branch label set.
 * @param remote - Remote branch label set.
 */
function classifyDecoration(
  decoration: string,
  tags: Set<string>,
  local: Set<string>,
  remote: Set<string>,
): void {
  const target = readDecorationTarget(decoration);

  if (target === null) {
    return;
  }

  if (target.startsWith(TAG_PREFIX)) {
    tags.add(readBadgeLabel(target.slice(TAG_PREFIX.length), TAG_REF_PREFIX));
    return;
  }

  if (target.startsWith(TAG_REF_PREFIX)) {
    tags.add(readBadgeLabel(target, TAG_REF_PREFIX));
    return;
  }

  if (target.startsWith(LOCAL_BRANCH_PREFIX)) {
    local.add(readBadgeLabel(target, LOCAL_BRANCH_PREFIX));
    return;
  }

  if (target.startsWith(REMOTE_BRANCH_PREFIX)) {
    remote.add(readBadgeLabel(target, REMOTE_BRANCH_PREFIX));
  }
}

/**
 * Reads the ref an entry points at, following a symbolic `A -> B` form.
 *
 * @param decoration - Raw decoration entry.
 * @returns The target ref, or null for an entry with no classifiable ref.
 */
function readDecorationTarget(decoration: string): string | null {
  const value = decoration.trim();

  if (value.length === 0 || value === "HEAD" || value.startsWith("HEAD, ")) {
    return null;
  }

  const separatorIndex = value.indexOf(SYMBOLIC_REF_SEPARATOR);

  if (separatorIndex >= 0) {
    return value.slice(separatorIndex + SYMBOLIC_REF_SEPARATOR.length).trim();
  }

  return value;
}

/**
 * Removes one ref prefix and limits the label length.
 *
 * @param value - Full ref or prefixed ref.
 * @param prefix - Prefix to remove.
 * @returns The display label.
 */
function readBadgeLabel(value: string, prefix: string): string {
  const withoutPrefix = value.startsWith(prefix) ? value.slice(prefix.length) : value;

  return truncateText(withoutPrefix, GRAPH_MAX_BADGE_LENGTH, "...");
}

/**
 * Measures one rendered badge, including its brackets.
 *
 * @param badge - Badge to measure.
 * @returns Character width of `[label]`.
 */
function measureBadge(badge: GraphRefBadge): number {
  return badge.label.length + BADGE_FRAME_WIDTH;
}

/**
 * Measures the overflow marker.
 *
 * @param overflow - Number of omitted badges.
 * @returns Character width of `+N`.
 */
function measureOverflow(overflow: number): number {
  return `+${overflow}`.length;
}

/**
 * Measures a rendered badge window.
 *
 * @param visible - Badges that remain visible.
 * @returns Character width including separators.
 */
function measureVisibleWidth(visible: readonly GraphRefBadge[]): number {
  return visible.reduce(
    (width, badge, index) =>
      width + (index === 0 ? 0 : BADGE_SEPARATOR_WIDTH) + measureBadge(badge),
    0,
  );
}
