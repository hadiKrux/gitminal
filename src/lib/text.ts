/** The indent unit inserted by Tab in a multiline text field. */
export const TEXT_INDENT_UNIT = "  ";

/**
 * Truncates text to a maximum display width using an explicit ellipsis.
 *
 * The helper is intentionally display-width naive: Gitminal's chrome is printable ASCII, so one
 * character occupies one cell. Callers that render user text in a wide-character context should
 * measure it first. The returned string never exceeds `maxWidth`.
 *
 * @param text - The text to shorten.
 * @param maxWidth - Maximum number of characters allowed in the result.
 * @param ellipsis - Marker appended when the text is shortened. Defaults to `...`, which matches
 * `ICONS.ellipsis`; `@/lib` cannot import the theme, so UI callers should pass it explicitly when
 * the icon configuration could change.
 * @returns The original text or a shortened form that fits the budget.
 */
export function truncateText(text: string, maxWidth: number, ellipsis: string = "..."): string {
  if (maxWidth <= 0) {
    return "";
  }

  if (text.length <= maxWidth) {
    return text;
  }

  if (ellipsis.length >= maxWidth) {
    return text.slice(0, maxWidth);
  }

  return text.slice(0, maxWidth - ellipsis.length) + ellipsis;
}

/**
 * Removes up to one indent unit from the start of a line.
 *
 * A leading tab counts as one unit, matching the editor behaviour where Tab moved the line in by a
 * single stop. Otherwise at most `indentUnit.length` leading spaces are removed. The helper is pure
 * so the Shift+Tab handler can decide whether anything changed before touching the edit buffer.
 *
 * @param line - The current line text without its line break.
 * @param indentUnit - The indent unit configured for the field.
 * @returns The outdented line and the number of removed characters.
 */
export function outdentLeadingIndent(
  line: string,
  indentUnit: string = TEXT_INDENT_UNIT,
): { readonly text: string; readonly removed: number } {
  if (line.startsWith("\t")) {
    return { text: line.slice(1), removed: 1 };
  }

  let removed = 0;

  while (removed < indentUnit.length && line[removed] === " ") {
    removed += 1;
  }

  return { text: line.slice(removed), removed };
}
