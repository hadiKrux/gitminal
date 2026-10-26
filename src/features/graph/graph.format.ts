import type { GraphScope } from "@/domain/config/config.types";
import { GRAPH_SCOPE_LABELS, GRAPH_SHORT_OID_LENGTH } from "@/features/graph/graph.constants";

/** Short English month names used by compact commit dates. */
const MONTH_NAMES: readonly string[] = Object.freeze([
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]);

/** Longest author name shown without shortening. */
const FULL_AUTHOR_MAX_LENGTH = 12;

/**
 * Reads the short hash shown on a search result.
 *
 * @param oid - Full commit OID.
 * @returns The first seven characters, or the whole OID when it is shorter.
 */
export function shortenOid(oid: string): string {
  return oid.slice(0, GRAPH_SHORT_OID_LENGTH);
}

/**
 * Shortens an author name to the graph row budget.
 *
 * Names up to twelve characters are shown as written. A longer name becomes the first letter of
 * its first two words, uppercased; a single long word becomes its first two characters, uppercased.
 *
 * @param authorName - Full author name from git.
 * @returns The display name, or an empty string for a blank name.
 */
export function shortenAuthor(authorName: string): string {
  const name = authorName.trim();

  if (name.length === 0) {
    return "";
  }

  if (name.length <= FULL_AUTHOR_MAX_LENGTH) {
    return name;
  }

  const words = name.split(/\s+/).filter((word) => word.length > 0);

  if (words.length >= 2) {
    return `${readFirstCharacter(words[0])}${readFirstCharacter(words[1])}`.toUpperCase();
  }

  return name.slice(0, 2).toUpperCase();
}

/**
 * Formats one commit timestamp as a compact local date.
 *
 * Commits from today show `HH:mm`, commits from the current year show `D Mon`, and older commits
 * show `D Mon YYYY`. The helper uses local calendar fields, so the value follows the terminal
 * machine's timezone like `git log --date=local` would.
 *
 * @param timestampSeconds - Committer time in seconds since the epoch.
 * @param nowMs - Current clock value in milliseconds.
 * @returns The compact date, or an empty string for an invalid timestamp.
 */
export function formatCommitDate(timestampSeconds: number, nowMs: number): string {
  const date = new Date(timestampSeconds * 1000);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const now = new Date(nowMs);
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (sameDay) {
    return `${padTwo(date.getHours())}:${padTwo(date.getMinutes())}`;
  }

  const dayAndMonth = `${date.getDate()} ${readMonthName(date.getMonth())}`;

  if (date.getFullYear() === now.getFullYear()) {
    return dayAndMonth;
  }

  return `${dayAndMonth} ${date.getFullYear()}`;
}

/**
 * Reads the display label of one graph scope.
 *
 * @param scope - Configured graph scope.
 * @returns The human-readable scope label.
 */
export function formatScopeLabel(scope: GraphScope): string {
  return GRAPH_SCOPE_LABELS[scope];
}

/**
 * Pads one date field to two digits.
 *
 * @param value - Non-negative integer.
 * @returns Two digits.
 */
function padTwo(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * Reads one month abbreviation.
 *
 * @param month - Zero-based month index.
 * @returns The short English month name.
 */
function readMonthName(month: number): string {
  return MONTH_NAMES[month] ?? "";
}

/**
 * Reads the first character of one word.
 *
 * @param word - Word to read, or undefined.
 * @returns The first character, or an empty string.
 */
function readFirstCharacter(word: string | undefined): string {
  return word?.slice(0, 1) ?? "";
}
