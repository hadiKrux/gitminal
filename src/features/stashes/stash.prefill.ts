/** Number of object-name characters shown in the create prefill. */
const SHORT_OID_LENGTH = 7;

/**
 * Builds the deterministic Create Stash message prefill from snapshot facts.
 *
 * An attached HEAD uses git's own `WIP on <branch>: <short hash> <subject>` wording, including the
 * HEAD subject the snapshot carries. A detached HEAD has no branch, so it uses
 * `WIP at <short hash> <subject>`; when no subject was read, the previous short form is kept. An
 * unborn HEAD keeps the previous branch-based `WIP at` fallback, and `WIP` alone is returned only
 * before the first snapshot, because guessing a commit would be worse than leaving the field
 * editable.
 *
 * @param snapshot - Current snapshot facts, or null before the first read.
 * @returns A short non-empty stash message.
 */
export function buildStashMessagePrefill(
  snapshot: {
    readonly branch: string | null;
    readonly shortHash: string | null;
    readonly headOid: string | null;
    readonly headSubject: string | null;
  } | null,
): string {
  if (snapshot === null) {
    return "WIP";
  }

  const shortOid = snapshot.headOid?.slice(0, SHORT_OID_LENGTH) ?? snapshot.shortHash;
  const subject = snapshot.headSubject?.trim() ?? "";

  if (snapshot.branch !== null && shortOid !== null) {
    return subject.length === 0
      ? `WIP on ${snapshot.branch}: ${shortOid}`
      : `WIP on ${snapshot.branch}: ${shortOid} ${subject}`;
  }

  const label = snapshot.branch ?? snapshot.shortHash ?? shortOid ?? "HEAD";

  return subject.length === 0 ? `WIP at ${label}` : `WIP at ${label} ${subject}`;
}

/**
 * Reads a stash message that is safe to show inside a sentence.
 *
 * @param stash - Stash record.
 * @returns The raw subject, or a placeholder when git recorded none.
 */
export function readStashMessage(stash: { readonly subject: string }): string {
  return stash.subject.length > 0 ? stash.subject : "(no message)";
}
