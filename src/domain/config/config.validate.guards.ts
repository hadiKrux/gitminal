import { DIFF_CONTEXT_LINES_RANGE, GRAPH_PAGE_SIZE_RANGE } from "./config.defaults";

/**
 * Re-exports the shared plain-object predicate for this module's public contract.
 *
 * Callers that already import configuration guards keep working; the implementation lives in
 * `@/lib/object` so configuration, theme, and palette decoding share one definition.
 */
export { isPlainObject } from "@/lib/object";

/**
 * Reports whether a value is a non-empty string.
 *
 * @param value - Candidate value.
 * @returns True when the value is a string with at least one non-space character.
 */
export function isNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Reports whether a value is a string.
 *
 * A theme name is any string here; the theme resolver classifies unknown names and reports them, so
 * validation only rejects the wrong JSON type.
 *
 * @param value - Candidate value.
 * @returns True when the value is a string.
 */
export function isStringValue(value: unknown): boolean {
  return typeof value === "string";
}

/**
 * Reports whether a value is a boolean.
 *
 * @param value - Candidate value.
 * @returns True when the value is a boolean.
 */
export function isBooleanValue(value: unknown): boolean {
  return typeof value === "boolean";
}

/**
 * Reports whether a value names an accepted commit graph scope.
 *
 * @param value - Candidate value.
 * @returns True when the value is `all`, `local`, or `current`.
 */
export function isGraphScope(value: unknown): boolean {
  return value === "all" || value === "local" || value === "current";
}

/**
 * Reports whether a value names an accepted remote fetch scope.
 *
 * @param value - Candidate value.
 * @returns True when the value is `local` or `current`.
 */
export function isFetchScope(value: unknown): boolean {
  return value === "local" || value === "current";
}

/**
 * Reports whether a value names an accepted commit graph glyph style.
 *
 * @param value - Candidate value.
 * @returns True when the value is `rounded` or `sharp`.
 */
export function isGraphStyle(value: unknown): boolean {
  return value === "rounded" || value === "sharp";
}

/**
 * Reports whether a value is a commit graph page size inside the documented range.
 *
 * @param value - Candidate value.
 * @returns True when the value is an integer in the allowed range.
 */
export function isPageSize(value: unknown): boolean {
  return isIntegerInRange(value, GRAPH_PAGE_SIZE_RANGE.min, GRAPH_PAGE_SIZE_RANGE.max);
}

/**
 * Reports whether a value is a diff context-line count inside the documented range.
 *
 * @param value - Candidate value.
 * @returns True when the value is an integer in the allowed range.
 */
export function isContextLines(value: unknown): boolean {
  return isIntegerInRange(value, DIFF_CONTEXT_LINES_RANGE.min, DIFF_CONTEXT_LINES_RANGE.max);
}

/**
 * Reports whether a value is an integer inside a documented range.
 *
 * @param value - Candidate value.
 * @param min - Minimum accepted value.
 * @param max - Maximum accepted value.
 * @returns True when the value is an integer between the bounds.
 */
function isIntegerInRange(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}
