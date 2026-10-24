import { classifyGitFailure } from "./git.errors";
import type { GitClient, GitReadOptions, StatusReadResult } from "./git.types";
import { parseStatus } from "./parsers/parse.status";

/** Canonical status arguments used everywhere in the app. */
export const STATUS_ARGS: readonly string[] = Object.freeze([
  "status",
  "--porcelain=v2",
  "--branch",
  "-z",
  "--untracked-files=all",
]);

/**
 * Reads the canonical repository status.
 *
 * The invocation is the only status form used by the app:
 * `git status --porcelain=v2 --branch -z --untracked-files=all`. It observes the index, so the git
 * client serializes it against writes. A failed read returns the classified failure instead of
 * throwing, and a successful read always returns a snapshot.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Working directory and cancellation signal.
 * @returns The parsed snapshot or the classified failure.
 */
export async function readStatus(
  client: GitClient,
  options: GitReadOptions,
): Promise<StatusReadResult> {
  const result = await client.invoke({
    args: STATUS_ARGS,
    cwd: options.cwd,
    signal: options.signal,
    operationClass: "read",
    touchesIndex: true,
  });

  if (!result.ok) {
    return { ok: false, snapshot: null, failure: classifyGitFailure(result) };
  }

  return { ok: true, snapshot: parseStatus(result.stdout), failure: null };
}
