import os from "node:os";
import path from "node:path";

/**
 * Normalizes an absolute path for comparison.
 *
 * Windows paths are compared case-insensitively because the filesystem usually is, while macOS is
 * compared case-sensitively to avoid collapsing two genuinely different paths on a case-sensitive
 * volume.
 *
 * @param value - Absolute or relative path.
 * @returns The absolute, platform-normalized comparison key.
 */
function toComparisonKey(value: string): string {
  const resolved = path.resolve(value);

  if (process.platform === "win32") {
    return resolved.toLowerCase();
  }

  return resolved;
}

/**
 * Reports whether two paths point at the same location.
 *
 * @param left - First path.
 * @param right - Second path.
 * @returns True when both resolve to the same comparison key.
 */
export function isSamePath(left: string, right: string): boolean {
  return toComparisonKey(left) === toComparisonKey(right);
}

/**
 * Reports whether a path is strictly inside another directory.
 *
 * A path is not a subdirectory of itself. The check uses `path.relative`, so `..` segments and
 * trailing separators cannot produce a false positive.
 *
 * @param candidate - Path that may be nested.
 * @param root - Directory that may contain the candidate.
 * @returns True when the candidate is nested below the root.
 */
export function isSubdirectory(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));

  if (relative.length === 0 || path.isAbsolute(relative)) {
    return false;
  }

  return relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

/**
 * Abbreviates an absolute path inside the user's home directory with `~`.
 *
 * Only absolute paths at or below the home directory are abbreviated. A relative path or a path on
 * another volume is returned unchanged, so a value that is not a home-relative location is never
 * misrepresented as one.
 *
 * @param value - Absolute path to abbreviate.
 * @param homeDir - Home directory to compare against. Defaults to `os.homedir()`.
 * @returns `~` for the home directory itself, `~/...` for a path inside it, or the original value.
 */
export function toHomeRelativePath(value: string, homeDir: string = os.homedir()): string {
  if (!path.isAbsolute(value)) {
    return value;
  }

  if (isSamePath(value, homeDir)) {
    return "~";
  }

  if (!isSubdirectory(value, homeDir)) {
    return value;
  }

  const relative = path
    .relative(path.resolve(homeDir), path.resolve(value))
    .split(path.sep)
    .join("/");

  return `~/${relative}`;
}

/**
 * Shortens a path to a maximum width while keeping its final segments.
 *
 * Paths are read from the tail because the last segment names the repository, so a clipped
 * repository path still tells the user where they are. The helper is display-width naive for the
 * same reason as `truncateText`: Gitminal's chrome is printable ASCII, so one character occupies one
 * cell.
 *
 * @param value - Absolute or relative path to shorten.
 * @param maxWidth - Maximum number of characters allowed in the result.
 * @param ellipsis - Marker prepended when the path is shortened. Defaults to `...`.
 * @returns The original path or its shortened tail within the budget.
 */
export function shortenPath(value: string, maxWidth: number, ellipsis: string = "..."): string {
  if (maxWidth <= 0) {
    return "";
  }

  if (value.length <= maxWidth) {
    return value;
  }

  if (ellipsis.length >= maxWidth) {
    return value.slice(value.length - maxWidth);
  }

  return ellipsis + value.slice(value.length - (maxWidth - ellipsis.length));
}

/**
 * Expresses an absolute path relative to a repository root with forward slashes.
 *
 * Paths outside the root are still expressed relatively so an error message can show them without
 * pretending they belong to the repository.
 *
 * @param absolutePath - Absolute path to convert.
 * @param root - Repository root.
 * @returns The root-relative path using `/` separators.
 */
export function toRootRelativePath(absolutePath: string, root: string): string {
  return path.relative(path.resolve(root), path.resolve(absolutePath)).split(path.sep).join("/");
}
