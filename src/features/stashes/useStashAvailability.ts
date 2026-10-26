import { useEffect } from "react";
import { publishActionAvailability } from "@/app/hooks/useActionAvailability";
import type { StashRecord } from "@/domain/git/git.types";
import {
  readAvailabilityReason,
  readStashActionAvailability,
} from "@/features/stashes/stash.availability";
import { STASHES_REGION_ID } from "@/features/stashes/useStashes.constants";
import type { RepositoryReader } from "@/features/stashes/useStashes.types";

/**
 * Reads and publishes the four stash action availabilities.
 *
 * The footer, help, and palette read the registry instead of importing the feature, so an
 * unavailable apply, pop, or delete is hidden for the selected row and create is hidden while the
 * whole-shell gate blocks it. Each effect cleans up its exact publication when the target or
 * availability changes or the panel unmounts.
 *
 * @param repository - Current repository context.
 * @param selected - Active stash, or null when the list has none.
 * @param totalCount - Number of stashes in the snapshot.
 * @returns The availabilities plus their display reasons.
 */
export function useStashAvailability(
  repository: RepositoryReader,
  selected: StashRecord | null,
  totalCount: number,
) {
  const createAvailability = repository.getAvailability(
    "stash.create",
    { kind: "none" },
    STASHES_REGION_ID,
  );
  const applyAvailability = readStashActionAvailability(
    repository,
    "stash.apply",
    selected,
    totalCount,
  );
  const popAvailability = readStashActionAvailability(
    repository,
    "stash.pop",
    selected,
    totalCount,
  );
  const deleteAvailability = readStashActionAvailability(
    repository,
    "stash.delete",
    selected,
    totalCount,
  );

  usePublishedAvailability("stash.create", createAvailability.available);
  usePublishedAvailability("stash.apply", applyAvailability.available);
  usePublishedAvailability("stash.pop", popAvailability.available);
  usePublishedAvailability("stash.delete", deleteAvailability.available);

  return {
    createAvailability,
    createReason: readAvailabilityReason(createAvailability),
    applyReason: readAvailabilityReason(applyAvailability),
    popReason: readAvailabilityReason(popAvailability),
    deleteReason: readAvailabilityReason(deleteAvailability),
  };
}

/**
 * Publishes one action's availability for the current stash target.
 *
 * @param actionId - Stash action id.
 * @param available - True when the action can run for the selected target.
 */
function usePublishedAvailability(actionId: string, available: boolean): void {
  useEffect(
    () => publishActionAvailability(STASHES_REGION_ID, actionId, available),
    [actionId, available],
  );
}
