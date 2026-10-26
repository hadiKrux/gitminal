import {
  lstat,
  mkdir,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  STALE_TEMP_FILE_AGE_MS,
  TEMP_FILE_MIDDLE_PATTERN,
  TEMP_FILE_SUFFIX,
  TEMP_FILE_TOKEN_FALLBACK,
} from "./config.atomic.constants";
import type { ConfigAtomicWriteOptions } from "./config.atomic.types";
import { isMissingFileError } from "./config.errors";

/**
 * Replaces one configuration file atomically without touching its document semantics.
 *
 * The new content goes to a sibling temp file that is renamed over the target, so a crash or a full
 * disk cannot leave a truncated file. The parent directory is created recursively first, so a fresh
 * install and a link into a directory that does not exist yet both succeed. The target is resolved
 * first so a symlinked `config.json` is updated through the link rather than replaced, and the
 * existing permission bits are applied to the temp file so the rename cannot loosen a hardened file.
 * A failed write or rename removes the temp file and rethrows, which leaves the previous file
 * exactly as it was.
 *
 * Leftover temp files from a killed process are swept before the new one is written. The sweep only
 * removes this writer's own `<digits>-<base36 token>` shape and only when its `mtime` is older than
 * `STALE_TEMP_FILE_AGE_MS`, so a second gitminal process that is between its write and its rename
 * keeps its temp file. The writer still expects to be the only long-lived writer of the target: a
 * sibling that does not match the shape is never touched.
 *
 * @param filePath - Absolute target path.
 * @param content - Serialized configuration text.
 * @param options - Rename override used by tests.
 */
export async function writeConfigAtomically(
  filePath: string,
  content: string,
  options: ConfigAtomicWriteOptions = {},
): Promise<void> {
  const targetPath = await resolveWriteTarget(filePath);

  await mkdir(dirname(targetPath), { recursive: true });
  await sweepStaleTempFiles(targetPath);

  const mode = await readExistingMode(targetPath);
  const tempPath = buildTempPath(targetPath);

  try {
    await defaultFileWriter(tempPath, content, mode);
    await (options.renameFile ?? defaultFileRenamer)(tempPath, targetPath);
  } catch (error) {
    await removeTempFile(tempPath);

    throw error;
  }
}

/**
 * Resolves the path the atomic write replaces.
 *
 * An existing symlink is resolved to its target, so a dotfiles `config.json` keeps being a link to
 * the managed file and the write never replaces the link itself. A missing file and an ordinary
 * file keep the configured path. A dangling link resolves through its raw target, which creates the
 * missing file the link points at instead of replacing the link with a regular file.
 *
 * @param filePath - Absolute target path from configuration.
 * @returns The path to write and rename onto.
 * @throws When the path cannot be inspected for a reason other than a missing file.
 */
async function resolveWriteTarget(filePath: string): Promise<string> {
  try {
    const details = await lstat(filePath);

    return details.isSymbolicLink() ? await resolveSymlinkTarget(filePath) : filePath;
  } catch (error) {
    if (isMissingFileError(error)) {
      return filePath;
    }

    throw error;
  }
}

/**
 * Resolves the file an existing symlink points at.
 *
 * `realpath` handles an existing target, including a chain of links. A dangling link has no real
 * path, so its raw target is read instead and a relative target is resolved against the directory
 * holding the link, which is the resolution the kernel performs when the link is opened.
 *
 * @param linkPath - Path already known to be a symlink.
 * @returns The absolute path the write replaces.
 * @throws When the link target cannot be resolved, for example a link loop.
 */
async function resolveSymlinkTarget(linkPath: string): Promise<string> {
  try {
    return await realpath(linkPath);
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }

  return resolve(dirname(linkPath), await readlink(linkPath));
}

/**
 * Removes this writer's stale temp files for one target.
 *
 * A `SIGKILL` between the temp write and the rename cannot run the failure cleanup, so its temp file
 * survives. Every sibling whose name matches this writer's own `.config.json.<digits>-<token>.tmp`
 * shape and whose `mtime` is older than `STALE_TEMP_FILE_AGE_MS` is removed best-effort: a listing,
 * stat, or removal failure is ignored, and no other file is touched.
 *
 * @param targetPath - Absolute target path the temp files belong to.
 */
async function sweepStaleTempFiles(targetPath: string): Promise<void> {
  const directory = dirname(targetPath);
  const prefix = readTempFilePrefix(targetPath);
  const entries = await readdir(directory).catch((): string[] => []);
  const now = Date.now();
  const stale = entries.filter((entry) => isTempFileName(entry, prefix));

  await Promise.all(
    stale.map(async (entry) => {
      const tempPath = join(directory, entry);

      if (await isStaleTempFile(tempPath, now)) {
        await removeTempFile(tempPath);
      }
    }),
  );
}

/**
 * Reports whether one directory entry is this writer's temp file for the target.
 *
 * Exported so the shape predicate can be tested directly instead of only through a write.
 *
 * @param entry - Directory entry name.
 * @param prefix - Dot-prefixed base name plus its trailing separator.
 * @returns True when the name has the documented `<digits>-<token>.tmp` shape.
 */
export function isTempFileName(entry: string, prefix: string): boolean {
  if (!entry.startsWith(prefix) || !entry.endsWith(TEMP_FILE_SUFFIX)) {
    return false;
  }

  const middle = entry.slice(prefix.length, entry.length - TEMP_FILE_SUFFIX.length);

  return TEMP_FILE_MIDDLE_PATTERN.test(middle);
}

/**
 * Reports whether a temp file is old enough to be residue from a killed process.
 *
 * A missing file or an unreadable `mtime` is treated as not stale, so the sweep never removes a file
 * it could not inspect. Exported so the age predicate can be tested directly.
 *
 * @param tempPath - Candidate temp path.
 * @param now - Timestamp captured once for the whole sweep.
 * @returns True when the file is older than `STALE_TEMP_FILE_AGE_MS`.
 */
export async function isStaleTempFile(tempPath: string, now: number): Promise<boolean> {
  try {
    const details = await stat(tempPath);

    return now - details.mtimeMs > STALE_TEMP_FILE_AGE_MS;
  } catch {
    return false;
  }
}

/**
 * Reads the permission bits to preserve on the replacement file.
 *
 * @param filePath - Absolute target path, already resolved through any symlink.
 * @returns The existing mode, or undefined when the target is new.
 * @throws When the path cannot be inspected for a reason other than a missing file.
 */
async function readExistingMode(filePath: string): Promise<number | undefined> {
  try {
    const details = await stat(filePath);

    return details.mode & 0o777;
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }

    throw error;
  }
}

/**
 * Builds the filename prefix shared by every temp file for one target.
 *
 * @param filePath - Absolute target path.
 * @returns The dot-prefixed base name plus its trailing separator.
 */
function readTempFilePrefix(filePath: string): string {
  return `.${basename(filePath)}.`;
}

/**
 * Builds a unique sibling temp path for one configuration file.
 *
 * @param filePath - Absolute target path.
 * @returns The temp path in the same directory.
 */
function buildTempPath(filePath: string): string {
  return join(
    dirname(filePath),
    `${readTempFilePrefix(filePath)}${Date.now()}-${randomToken()}${TEMP_FILE_SUFFIX}`,
  );
}

/**
 * Builds a short random token for a temp filename.
 *
 * A base-36 slice can be empty, so an empty token falls back to a fixed digit; the temp name always
 * matches the shape the stale sweep recognizes.
 *
 * @returns A non-empty base-36 token that needs no extra import.
 */
function randomToken(): string {
  const token = Math.random().toString(36).slice(2);

  return token.length === 0 ? TEMP_FILE_TOKEN_FALLBACK : token;
}

/**
 * Removes one temp file without masking the operation it cleans up after.
 *
 * Used both by the failure path of the atomic write and by the stale sweep, so a cleanup failure must
 * never replace the write, rename, or sweep outcome the caller reports.
 *
 * @param tempPath - Temp file to remove.
 */
async function removeTempFile(tempPath: string): Promise<void> {
  try {
    await rm(tempPath, { force: true });
  } catch {
    // A cleanup failure must not replace the write or rename failure the caller reports.
  }
}

/**
 * Default writer backed by `fs/promises`.
 *
 * The optional mode is applied when the file is created, which is how the atomic path carries the
 * previous file's permission bits onto the temp file before the rename.
 *
 * @param filePath - Absolute path to write.
 * @param content - File content as text.
 * @param mode - Permission bits for a new file, omitted to keep the platform default.
 */
async function defaultFileWriter(filePath: string, content: string, mode?: number): Promise<void> {
  await writeFile(
    filePath,
    content,
    mode === undefined ? { encoding: "utf8" } : { encoding: "utf8", mode },
  );
}

/**
 * Default rename backed by `fs/promises`.
 *
 * @param source - Temp path written by the atomic write.
 * @param destination - Target configuration path.
 */
async function defaultFileRenamer(source: string, destination: string): Promise<void> {
  await rename(source, destination);
}
