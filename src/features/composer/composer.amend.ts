import { readMessage, readShortHash } from "@/domain/git/git.log";
import type { GitClient } from "@/domain/git/git.types";
import type { AmendHeadRead } from "./composer.types";

/** Warning shown when the previous commit message cannot be read for amend. */
export const AMEND_READ_FAILED = "Could not read the previous commit message";

/**
 * Reads HEAD's stored message and short hash for an amend.
 *
 * The short hash is read first because it proves HEAD exists before the message read. Either read
 * failing returns the shared failure shape so the caller can report the same warning for both.
 *
 * @param client - Git client bound to the configured executable.
 * @param cwd - Repository working directory.
 * @param signal - Abort signal owned by the menu session.
 * @returns The message and short hash, or the failure marker.
 */
export async function readHeadCommit(
  client: GitClient,
  cwd: string,
  signal: AbortSignal,
): Promise<AmendHeadRead> {
  const shortHash = await readShortHash(client, { cwd, signal });

  if (!shortHash.ok) {
    return { ok: false, cancelled: readCancelled(shortHash.failure, signal) };
  }

  const message = await readMessage(client, { cwd, signal });

  if (!message.ok) {
    return { ok: false, cancelled: readCancelled(message.failure, signal) };
  }

  return { ok: true, message: message.text, shortHash: shortHash.text };
}

/**
 * Reports whether a failed read was cancelled or superseded rather than a real failure.
 *
 * @param failure - Classified git failure, when the read produced one.
 * @param signal - Signal owned by the menu session.
 * @returns True when the read was cancelled or the owning signal was aborted.
 */
function readCancelled(
  failure: { readonly cancelled: boolean } | null,
  signal: AbortSignal,
): boolean {
  return signal.aborted || failure?.cancelled === true;
}
