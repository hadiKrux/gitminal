import { readFile, stat } from "node:fs/promises";
import { writeConfigAtomically } from "./config.atomic";
import { DEFAULT_CONFIG_VERSION } from "./config.defaults";
import { isMissingFileError, readErrorMessage } from "./config.errors";
import { MAX_CONFIG_FILE_BYTES } from "./config.loader";
import { resolveConfigPaths } from "./config.paths";
import type { ExistingConfigRead, ThemeWriteResult, WriteThemeOptions } from "./config.types";
import { isPlainObject } from "./config.validate.guards";

/** Minimal valid configuration created when no file exists yet. */
const MINIMAL_CONFIG_TEMPLATE: Readonly<Record<string, unknown>> = Object.freeze({
  version: DEFAULT_CONFIG_VERSION,
});

/**
 * Writes the selected theme into `config.json`.
 *
 * Only the `theme` field changes; every other field of an existing file is preserved as written,
 * including unknown fields, so a user file never loses data. When the file does not exist, a
 * minimal valid configuration holding the schema version and the selected theme is created. An
 * existing file over the shared 256 KB read cap is refused rather than buffered, and a malformed
 * file is left untouched.
 *
 * The replacement is atomic and lives in `config.atomic.ts`: the new content is written to a
 * sibling temp file and renamed over `config.json`, a symlinked `config.json` is written through to
 * its target, the existing permission bits are carried over, and a leftover temp file from a killed
 * process is swept before the write. `config.atomic.constants.ts` owns the temp filename shape and
 * the stale age bound, so those rules have one source of truth. The writer never throws: an
 * unwritable directory, a malformed file, or any other filesystem failure returns a failed result
 * with a reason and leaves the original file untouched.
 *
 * @param themeName - Selected built-in theme name.
 * @param options - Path and filesystem overrides used by tests.
 * @returns Whether the write succeeded, with a reason on failure.
 */
export async function writeTheme(
  themeName: string,
  options: WriteThemeOptions = {},
): Promise<ThemeWriteResult> {
  const filePath =
    options.configPath ??
    resolveConfigPaths({
      env: options.env,
      homeDir: options.homeDir,
      platform: options.platform,
    }).config;

  if (filePath === null) {
    return { ok: false, reason: "No config.json location could be resolved" };
  }

  const existing = await readExistingConfig(filePath, options.readFile);

  if (existing.value === null) {
    return { ok: false, reason: existing.reason ?? "config.json could not be read" };
  }

  const content = `${JSON.stringify({ ...existing.value, theme: themeName }, null, 2)}\n`;

  try {
    await writeConfigFile(filePath, content, options);
  } catch (error) {
    return { ok: false, reason: `Could not write ${filePath}: ${readErrorMessage(error)}` };
  }

  return { ok: true };
}

/**
 * Reads the existing `config.json` before it is rewritten.
 *
 * A missing file falls back to the minimal template, which the writer then extends with the theme
 * field. A malformed file is a failure per F-20: the file is left untouched and a reason is returned
 * instead of a partial write.
 *
 * @param filePath - Absolute path to the main configuration file.
 * @param reader - Reader override used by tests.
 * @returns The parsed configuration or the failure reason.
 */
async function readExistingConfig(
  filePath: string,
  reader?: (path: string) => Promise<string>,
): Promise<ExistingConfigRead> {
  let content: string;

  try {
    content = await (reader ?? defaultFileReader)(filePath);
  } catch (error) {
    if (isMissingFileError(error)) {
      return { value: { ...MINIMAL_CONFIG_TEMPLATE }, reason: null };
    }

    return { value: null, reason: `Could not read ${filePath}: ${readErrorMessage(error)}` };
  }

  return parseRawConfig(content);
}

/**
 * Parses the raw configuration content into a plain object.
 *
 * @param content - Raw file text.
 * @returns The object, or the failure reason for a malformed file.
 */
function parseRawConfig(content: string): ExistingConfigRead {
  if (Buffer.byteLength(content, "utf8") > MAX_CONFIG_FILE_BYTES) {
    return {
      value: null,
      reason: `config.json is larger than ${MAX_CONFIG_FILE_BYTES} bytes; the theme was not saved`,
    };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch (error) {
    return { value: null, reason: `config.json is malformed: ${readErrorMessage(error)}` };
  }

  if (!isPlainObject(parsed)) {
    return { value: null, reason: "config.json is not a JSON object; the theme was not saved" };
  }

  return { value: parsed, reason: null };
}

/**
 * Writes the configuration file.
 *
 * An injected writer performs the final write itself, which is the seam the injected-filesystem
 * tests use. The default path delegates to the atomic writer, which creates the parent directory,
 * resolves a symlink to its target, and replaces the target through a sibling temp file.
 *
 * @param filePath - Absolute target path.
 * @param content - Serialized configuration text.
 * @param options - Writer and rename overrides used by tests.
 */
async function writeConfigFile(
  filePath: string,
  content: string,
  options: WriteThemeOptions,
): Promise<void> {
  if (options.writeFile !== undefined) {
    await options.writeFile(filePath, content);

    return;
  }

  await writeConfigAtomically(filePath, content, { renameFile: options.renameFile });
}

/**
 * Default reader backed by `fs/promises`.
 *
 * A file over the shared read cap fails before its content is buffered, matching the loader.
 *
 * @param filePath - Absolute path to read.
 * @returns The file content as text.
 * @throws When the file exceeds the read cap or the read fails.
 */
async function defaultFileReader(filePath: string): Promise<string> {
  const details = await stat(filePath);

  if (details.size > MAX_CONFIG_FILE_BYTES) {
    throw new Error(`config.json is larger than ${MAX_CONFIG_FILE_BYTES} bytes`);
  }

  return await readFile(filePath, "utf8");
}
