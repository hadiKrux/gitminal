/**
 * Clamps an index into the bounds of a list.
 *
 * Every cursor, window, and selection in the app moves by relative deltas, so a requested index can
 * be negative, fractional, or non-finite. The result is always a whole index the caller can use to
 * read a row, and an empty list always yields `0`, which leaves the caller's empty-state check in
 * charge instead of producing a negative index.
 *
 * @param index - Requested index, possibly negative, fractional, or non-finite.
 * @param length - Number of available rows.
 * @returns A whole index between `0` and `length - 1`, or `0` for an empty list.
 */
export function clampIndex(index: number, length: number): number {
  if (length <= 0 || !Number.isFinite(index)) {
    return 0;
  }

  return Math.min(Math.max(0, Math.trunc(index)), length - 1);
}
