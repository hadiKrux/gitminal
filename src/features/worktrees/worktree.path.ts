/** Directory name used when a branch name leaves no usable filesystem component. */
const FALLBACK_DIRECTORY_NAME = "worktree";

/** Characters a filesystem path component cannot keep on macOS, Linux, or Windows. */
const UNSAFE_PATH_CHARACTERS = '<>:"|?*';

/**
 * Derives the prefilled sibling worktree path from a base path and a branch name.
 *
 * The new directory is a sibling of the current worktree, so a repository under
 * `/home/user/code/repo` offers `/home/user/code/<branch>`. When no base path is known the result is
 * empty, because guessing a directory would be worse than asking. When the sanitized branch is
 * empty the fallback directory name keeps the field prefilled and usable.
 *
 * @param basePath - Current worktree path, repository root, or null.
 * @param branch - Branch name being typed or selected.
 * @returns The absolute sibling path, or an empty string without a base path.
 */
export function deriveWorktreePath(basePath: string | null, branch: string): string {
  if (basePath === null || basePath.length === 0) {
    return "";
  }

  const parent = readParentDirectory(basePath);
  const directory = sanitizeBranchForPath(branch) || FALLBACK_DIRECTORY_NAME;

  return joinPath(parent, directory);
}

/**
 * Makes a branch name usable as one filesystem path component.
 *
 * Slashes become hyphens so `feature/login` stays one sibling directory rather than nesting, and
 * characters that are illegal or awkward on a filesystem are replaced. Runs of separators collapse,
 * and leading or trailing separators and dots are removed. The result is display-only: the branch
 * name sent to git is never sanitized.
 *
 * @param branch - Branch name.
 * @returns A safe, possibly empty path component.
 */
export function sanitizeBranchForPath(branch: string): string {
  return branch
    .trim()
    .split("")
    .map(toPathCharacter)
    .join("")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
}

/**
 * Reads the parent directory of an absolute path without a filesystem module.
 *
 * The feature layer may not import `node:path`, so the helper normalizes Windows separators to
 * forward slashes and takes the text before the last one. A root-level path keeps `/` as its parent,
 * and a path with no separator falls back to the current directory marker.
 *
 * @param value - Absolute or relative path.
 * @returns The parent directory with forward slashes.
 */
function readParentDirectory(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");

  if (index < 0) {
    return ".";
  }

  return index === 0 ? "/" : normalized.slice(0, index);
}

/**
 * Joins one directory and one component with forward slashes.
 *
 * @param parent - Parent directory, or `/`.
 * @param name - Directory name.
 * @returns The joined path without a duplicated separator.
 */
function joinPath(parent: string, name: string): string {
  return parent === "/" ? `/${name}` : `${parent}/${name}`;
}

/**
 * Converts one branch-name character into a safe path character.
 *
 * Slashes and backslashes become hyphens so a branch cannot introduce directory nesting. Whitespace,
 * control characters, and characters illegal on a common filesystem also become hyphens.
 *
 * @param character - One character from the branch name.
 * @returns The character to keep, or a hyphen.
 */
function toPathCharacter(character: string): string {
  const code = character.charCodeAt(0);

  if (
    code <= 0x1f ||
    code === 0x7f ||
    character === "/" ||
    character === "\\" ||
    UNSAFE_PATH_CHARACTERS.includes(character) ||
    /\s/.test(character)
  ) {
    return "-";
  }

  return character;
}
