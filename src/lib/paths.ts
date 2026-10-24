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
