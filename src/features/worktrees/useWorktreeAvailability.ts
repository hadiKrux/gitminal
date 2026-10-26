import { useEffect } from "react";
import { publishActionAvailability } from "@/app/hooks/useActionAvailability";

/** Region the worktree availability publications belong to. */
const REGION_ID = "worktrees" as const;

/**
 * Publishes the two worktree action availabilities for the current selection.
 *
 * The footer, help, and palette read the registry instead of importing the feature, so
 * `worktree.delete` disappears for the current worktree and `worktree.create` disappears in an
 * empty repository. Each effect removes its exact publication when the target changes.
 *
 * @param createAvailable - True when a worktree can be created.
 * @param deleteAvailable - True when the selected worktree can be removed.
 */
export function useWorktreeAvailability(createAvailable: boolean, deleteAvailable: boolean): void {
  useEffect(
    () => publishActionAvailability(REGION_ID, "worktree.create", createAvailable),
    [createAvailable],
  );
  useEffect(
    () => publishActionAvailability(REGION_ID, "worktree.delete", deleteAvailable),
    [deleteAvailable],
  );
}
