/**
 * Reports whether a value is a plain JSON object.
 *
 * Arrays, `null`, and primitives are rejected, because every configuration group, keybinding map,
 * theme override layer, and decoded palette payload is an object. The predicate is intentionally
 * shallow: it validates the JSON container shape and leaves field validation to the owning module.
 *
 * @param value - Candidate value.
 * @returns True for a non-null, non-array object.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
