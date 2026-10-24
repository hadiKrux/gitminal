import type { GitFailure, GitFailureKind, GitInvocationResult } from "./git.types";

/** Stderr fragments that identify an authentication or network failure. */
const AUTH_NETWORK_PATTERNS: readonly RegExp[] = Object.freeze([
  /permission denied \(publickey/i,
  /authentication failed/i,
  /could not read username/i,
  /could not read password/i,
  /terminal prompts disabled/i,
  /could not resolve host/i,
  /could not resolve proxy/i,
  /connection (?:timed out|refused|reset)/i,
  /network is unreachable/i,
  /unable to access/i,
  /no such device or address/i,
  /the requested url returned error: (?:401|403)/i,
  /ssl certificate problem/i,
  /from the remote repository/i,
]);

/** Stderr fragments that identify a filesystem permission failure. */
const PERMISSION_PATTERNS: readonly RegExp[] = Object.freeze([
  /\bEACCES\b/,
  /\bEPERM\b/,
  /operation not permitted/i,
  /permission denied/i,
  /read-only file system/i,
  /insufficient permission/i,
]);

/** Stderr fragments that identify a hook failure. */
const HOOK_FAILURE_PATTERNS: readonly RegExp[] = Object.freeze([
  /hook declined/i,
  /pre-commit hook/i,
  /pre-push hook/i,
  /commit-msg hook/i,
  /\.git\/hooks\//i,
  /\bhook failed\b/i,
  /\bhusky\b/i,
]);

/** Stderr fragments that identify a non-fast-forward rejection. */
const NON_FAST_FORWARD_PATTERNS: readonly RegExp[] = Object.freeze([
  /non-fast-forward/i,
  /fetch first/i,
  /updates were rejected/i,
  /\[rejected\]/i,
]);

/** Stderr fragments that identify a directory that is not a git repository. */
const NOT_A_REPOSITORY_PATTERNS: readonly RegExp[] = Object.freeze([
  /not a git repository/i,
  /not a git work tree/i,
]);

/**
 * Classifies one invocation result into a failure category.
 *
 * Cancellation and timeout are checked first because a killed child often leaves partial stderr
 * that would otherwise be misread as an auth or repository failure. A spawn `ENOENT` means the
 * configured `git.path` does not exist. Remaining categories are matched against stderr in a fixed
 * precedence: repository, authentication or network, permission, hook, then non-fast-forward.
 *
 * @param result - The settled invocation result.
 * @returns The classified failure, including the decisive message.
 */
export function classifyGitFailure(result: GitInvocationResult): GitFailure {
  const stderr = result.stderr;
  const kind = readFailureKind(result, stderr);

  return {
    kind,
    exitCode: result.exitCode,
    message: readDecisiveMessage(result, kind),
    stderr,
    cancelled: result.cancelled,
    timedOut: result.timedOut,
  };
}

/**
 * Reports whether a result represents a failed invocation.
 *
 * @param result - The settled invocation result.
 * @returns True when the invocation did not exit cleanly.
 */
export function isGitFailure(result: GitInvocationResult): boolean {
  return !result.ok;
}

/**
 * Selects the failure kind for one result.
 *
 * @param result - The settled invocation result.
 * @param stderr - Captured standard error.
 * @returns The classified failure kind.
 */
function readFailureKind(result: GitInvocationResult, stderr: string): GitFailureKind {
  if (result.cancelled) {
    return "cancelled";
  }

  if (result.timedOut) {
    return "timed-out";
  }

  if (result.spawnError !== null) {
    return readSpawnFailureKind(result.spawnError.code);
  }

  if (matchesAny(stderr, NOT_A_REPOSITORY_PATTERNS)) {
    return "not-a-repository";
  }

  if (matchesAny(stderr, AUTH_NETWORK_PATTERNS)) {
    return "auth-network";
  }

  if (matchesAny(stderr, PERMISSION_PATTERNS)) {
    return "permission";
  }

  if (matchesAny(stderr, HOOK_FAILURE_PATTERNS)) {
    return "hook-failure";
  }

  if (matchesAny(stderr, NON_FAST_FORWARD_PATTERNS)) {
    return "non-fast-forward";
  }

  return "unknown";
}

/**
 * Maps a spawn error code to a failure kind.
 *
 * @param code - Platform error code, or null when the runtime reported none.
 * @returns `missing-git` for a missing executable, `permission` for an inaccessible one.
 */
function readSpawnFailureKind(code: string | null): GitFailureKind {
  if (code === "ENOENT") {
    return "missing-git";
  }

  if (code === "EACCES" || code === "EPERM") {
    return "permission";
  }

  return "unknown";
}

/**
 * Reports whether any pattern matches the captured stderr.
 *
 * @param stderr - Captured standard error.
 * @param patterns - Candidate patterns.
 * @returns True when at least one pattern matches.
 */
function matchesAny(stderr: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(stderr));
}

/**
 * Builds the decisive one-line message for a failure.
 *
 * A timeout reports its documented message, and an empty stderr falls back to the exit status so
 * the UI never shows a blank error.
 *
 * @param result - The settled invocation result.
 * @param kind - Classified failure kind.
 * @returns The message shown in the error overlay and the console entry.
 */
function readDecisiveMessage(result: GitInvocationResult, kind: GitFailureKind): string {
  if (kind === "timed-out" && result.timedOutAfterMs !== null) {
    return `timed out after ${Math.round(result.timedOutAfterMs / 1000)} seconds`;
  }

  if (kind === "cancelled") {
    return "cancelled";
  }

  if (result.spawnError !== null) {
    return result.spawnError.code === "ENOENT"
      ? `git executable not found: ${result.argv[0] ?? "git"}`
      : result.spawnError.message;
  }

  const decisiveLine = readDecisiveStderrLine(result.stderr);

  if (decisiveLine.length > 0) {
    return decisiveLine;
  }

  if (result.exitCode !== null) {
    return `git exited with code ${result.exitCode}`;
  }

  return "git invocation failed";
}

/**
 * Reads the last fatal or error line from stderr.
 *
 * @param stderr - Captured standard error.
 * @returns The decisive line, or an empty string when stderr has no content.
 */
function readDecisiveStderrLine(stderr: string): string {
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];

    if (line !== undefined && /\b(fatal|error)\b/i.test(line)) {
      return line;
    }
  }

  return lines.at(-1) ?? "";
}
