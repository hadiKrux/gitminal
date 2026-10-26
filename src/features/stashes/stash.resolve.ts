import type { StashRecord } from "@/domain/git/git.types";

/**
 * Resolves the stash a successful create should select from the refreshed snapshot.
 *
 * The rows arrive newest first, so the first entry whose recorded message contains the submitted
 * message is the newest matching stash. When git recorded a different subject shape, the newest row
 * is a defensible fallback only when the list proves it grew since the command was submitted: a
 * stale read that still holds the pre-command list cannot move the selection to an old stash. The
 * function never keeps or compares a second list, so an external stash operation cannot make it
 * select a stale identity.
 *
 * @param rows - Refreshed stash rows in newest-first order.
 * @param message - Message that was submitted for the created stash.
 * @param previousCount - Stash count read when the create command was submitted.
 * @returns The stash to select, or null when this snapshot holds no evidence of the created stash.
 */
export function resolveCreatedStash(
  rows: readonly StashRecord[],
  message: string,
  previousCount: number,
): StashRecord | null {
  const target = message.trim();
  const matching = target.length === 0 ? [] : rows.filter((row) => row.subject.includes(target));
  const newestMatch = matching[0];

  if (newestMatch !== undefined) {
    return newestMatch;
  }

  if (rows.length <= previousCount) {
    return null;
  }

  return rows[0] ?? null;
}
