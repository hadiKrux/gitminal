import {
  selectRemoteBranchGroups,
  selectStashRows,
  selectTagRows,
  selectWorktreeRows,
} from "@/domain/repository/repository.selectors";
import type { RemoteTagCheck, RepositorySnapshot } from "@/domain/repository/repository.types";
import { ICONS } from "@/theme/icons";
import type { FeatureSearchItem, FeatureSearchModalProps } from "./FeatureSearchModal.types";

/**
 * Formats a display-only marker before the full name without changing search matching or identity.
 * @param item - Highlighted/result row, or undefined when the results are empty.
 * @returns The marked display name, or the empty-selection label.
 */
export function formatFeatureSearchName(item: FeatureSearchItem | undefined): string {
  if (item === undefined) {
    return "No selection";
  }

  return item.marker === undefined ? item.name : `${item.marker} ${item.name}`;
}

/**
 * Adapts repository selectors to full-name search rows without applying sidebar render caps.
 * @param region - Owning sidebar.
 * @param snapshot - Last successful repository snapshot.
 * @param tagChecks - Remote tag knowledge used by the Tags sidebar.
 * @returns Rows in the exact sidebar order, retaining remote prefixes and absolute paths.
 */
export function readFeatureSearchRows(
  region: FeatureSearchModalProps["region"],
  snapshot: RepositorySnapshot | null,
  tagChecks: Readonly<Record<string, RemoteTagCheck>>,
): readonly FeatureSearchItem[] {
  switch (region) {
    case "remotes":
      return selectRemoteBranchGroups(snapshot).flatMap((group) =>
        group.branches.map((branch) => ({
          id: `${group.remote}/${branch.branch}`,
          name: `${group.remote}/${branch.branch}`,
          ...(branch.hasLocalTracker ? { marker: ICONS.remoteLocalTracker } : {}),
          details: `Remote: ${group.remote}`,
        })),
      );
    case "tags":
      return selectTagRows(snapshot, tagChecks).map((tag) => ({
        id: tag.name,
        name: tag.name,
        details: `${tag.state} ${tag.targetOid} ${tag.remotes.join(", ")}`,
      }));
    case "stashes":
      return selectStashRows(snapshot).map((stash) => ({
        id: stash.objectName,
        name: `${stash.index} ${stash.subject}`,
        details: stash.objectName,
      }));
    case "worktrees":
      return selectWorktreeRows(snapshot).map((tree) => ({
        id: tree.path,
        name: tree.path,
        details: tree.branch ?? "detached HEAD",
      }));
  }
}
