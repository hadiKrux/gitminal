import { readFile, stat } from "node:fs/promises";
import { isMissingFileError, readErrorMessage } from "./config.errors";
import type {
  ConfigFileKey,
  ConfigFileLoad,
  ConfigFilePaths,
  ConfigFileRead,
  ConfigFileReader,
  LoadConfigFilesOptions,
  LoadedConfigFiles,
} from "./config.types";

/** Maximum bytes read from one configuration file. */
export const MAX_CONFIG_FILE_BYTES = 256 * 1024;

/** The three file keys in load order. */
const CONFIG_FILE_KEYS: readonly ConfigFileKey[] = Object.freeze([
  "config",
  "keybindings",
  "theme",
]);

/** Per-file display names used in warnings. */
const FILE_LABELS: Readonly<Record<ConfigFileKey, string>> = Object.freeze({
  config: "config.json",
  keybindings: "keybindings.json",
  theme: "theme.json",
});

/**
 * Reads the three optional configuration files.
 *
 * A missing file is a normal, silent outcome and does not warn. An unreadable file or one that does
 * not parse yields one warning naming the file and the failure reason, and its value stays `null`.
 * Each file is capped at `MAX_CONFIG_FILE_BYTES`: the default reader checks the size before reading
 * so a pathological file is never buffered, and the loader re-checks the returned text so an
 * injected reader cannot return an unbounded value. The warning is one bounded line. The loader
 * never throws, so a bad filesystem always degrades to defaults plus warnings.
 *
 * @param paths - Resolved file paths from `config.paths.ts`.
 * @param options - Reader override used by tests.
 * @returns One load outcome per file and the collected warnings.
 */
export async function loadConfigFiles(
  paths: ConfigFilePaths,
  options: LoadConfigFilesOptions = {},
): Promise<LoadedConfigFiles> {
  const reader = options.readFile ?? nodeFileReader;
  const files: ConfigFileLoad[] = [];
  const warnings: string[] = [];

  for (const key of CONFIG_FILE_KEYS) {
    const outcome = await readJsonFile(key, paths[key], reader);

    files.push(outcome.file);

    if (outcome.reason !== null) {
      warnings.push(outcome.reason);
    }
  }

  return { files, warnings };
}

/**
 * Reads and parses one JSON file.
 *
 * @param key - File key, used for warning labels.
 * @param filePath - Resolved path, or `null` when no location could be resolved.
 * @param reader - The reader to use.
 * @returns The load outcome plus the warning reason when the file failed.
 */
async function readJsonFile(
  key: ConfigFileKey,
  filePath: string | null,
  reader: ConfigFileReader,
): Promise<ConfigFileRead> {
  if (filePath === null) {
    return { file: { key, status: "missing", value: null, path: null }, reason: null };
  }

  let content: string;

  try {
    content = await readCappedFile(filePath, reader);
  } catch (error) {
    if (isMissingFileError(error)) {
      return { file: { key, status: "missing", value: null, path: filePath }, reason: null };
    }

    return {
      file: { key, status: "failed", value: null, path: filePath },
      reason: `Could not read ${FILE_LABELS[key]} (${filePath}): ${readErrorMessage(error)}`,
    };
  }

  return parseJsonFile(key, filePath, content);
}

/**
 * Reads one configuration file and enforces the byte cap.
 *
 * The content check runs after the reader returns, so an injected reader is capped too. The default
 * reader also checks the file size first, because that path must not buffer an oversized file at
 * all.
 *
 * @param filePath - Absolute path to read.
 * @param reader - The reader to use.
 * @returns The file text.
 * @throws When the file exceeds the cap or the read fails.
 */
async function readCappedFile(filePath: string, reader: ConfigFileReader): Promise<string> {
  const content = await reader(filePath);

  if (Buffer.byteLength(content, "utf8") > MAX_CONFIG_FILE_BYTES) {
    throw new Error(readTooLargeMessage());
  }

  return content;
}

/**
 * Builds the bounded warning text for a file over the read cap.
 *
 * @returns The one-line reason.
 */
function readTooLargeMessage(): string {
  return `file is larger than ${MAX_CONFIG_FILE_BYTES} bytes and was not read`;
}

/**
 * Parses the text of one configuration file.
 *
 * @param key - File key, used for warning labels.
 * @param filePath - Resolved path of the file.
 * @param content - Raw file text.
 * @returns The loaded outcome, or the parse failure reason.
 */
function parseJsonFile(key: ConfigFileKey, filePath: string, content: string): ConfigFileRead {
  try {
    const value: unknown = JSON.parse(content);

    return { file: { key, status: "loaded", value, path: filePath }, reason: null };
  } catch (error) {
    return {
      file: { key, status: "failed", value: null, path: filePath },
      reason: `Could not parse ${FILE_LABELS[key]} (${filePath}): ${readErrorMessage(error)}`,
    };
  }
}

/**
 * Default reader backed by `fs/promises`.
 *
 * It stats the file first, so a file over the cap fails with the bounded reason before any content
 * is buffered.
 *
 * @param filePath - Absolute path to read.
 * @returns The file content as text.
 * @throws When the file exceeds the cap or the read fails.
 */
async function nodeFileReader(filePath: string): Promise<string> {
  const details = await stat(filePath);

  if (details.size > MAX_CONFIG_FILE_BYTES) {
    throw new Error(readTooLargeMessage());
  }

  return await readFile(filePath, "utf8");
}
