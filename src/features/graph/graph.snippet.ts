import type { BodySnippet, HighlightSegment } from "@/features/graph/graph.types";

/** Characters of context kept before the first body match. */
const SNIPPET_PREFIX_CONTEXT = 24;

/**
 * Builds one normalized context snippet around the first body match.
 *
 * Matching is a literal, case-insensitive substring check over the whitespace-normalized body, so
 * regular-expression metacharacters never change the result. Terms that match only the subject
 * produce no snippet, because the body itself does not contain them.
 *
 * @param body - Commit message body.
 * @param terms - Parsed search terms.
 * @param budget - Maximum characters of snippet text before ellipsis markers.
 * @returns The snippet, or null when no term appears in the body.
 */
export function buildBodySnippet(
  body: string,
  terms: readonly string[],
  budget: number,
): BodySnippet | null {
  const normalized = normalizeWhitespace(body);

  if (normalized.length === 0 || terms.length === 0 || budget <= 0) {
    return null;
  }

  const matchIndex = findFirstTermIndex(normalized, terms);

  if (matchIndex < 0) {
    return null;
  }

  const start = Math.max(0, matchIndex - SNIPPET_PREFIX_CONTEXT);
  const end = Math.min(normalized.length, start + budget);

  return {
    text: normalized.slice(start, end),
    leadingEllipsis: start > 0,
    trailingEllipsis: end < normalized.length,
  };
}

/**
 * Splits text into plain and matched runs for inline highlighting.
 *
 * The match is case-insensitive and literal. When several terms match, the earliest occurrence
 * wins, and every overlapping or repeated occurrence is highlighted in one pass with no regular
 * expression compilation.
 *
 * @param text - Text to scan.
 * @param terms - Parsed search terms.
 * @returns Ordered runs; the whole text is one unmatched run when nothing matches.
 */
export function highlightTerms(
  text: string,
  terms: readonly string[],
): readonly HighlightSegment[] {
  if (text.length === 0) {
    return [];
  }

  const usableTerms = terms.filter((term) => term.length > 0);

  if (usableTerms.length === 0) {
    return [{ text, matched: false }];
  }

  const lowerText = text.toLowerCase();
  const lowerTerms = usableTerms.map((term) => term.toLowerCase());
  const segments: HighlightSegment[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const match = findNextMatch(lowerText, lowerTerms, cursor);

    if (match === null) {
      segments.push({ text: text.slice(cursor), matched: false });
      break;
    }

    if (match.index > cursor) {
      segments.push({ text: text.slice(cursor, match.index), matched: false });
    }

    const end = match.index + match.length;

    segments.push({ text: text.slice(match.index, end), matched: true });
    cursor = end;
  }

  return segments;
}

/**
 * Collapses every run of whitespace to one space and trims the result.
 *
 * @param value - Raw body text.
 * @returns The normalized body.
 */
function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Finds the earliest literal occurrence of any term.
 *
 * @param text - Lowercased text to scan.
 * @param terms - Parsed terms.
 * @returns The earliest character index, or -1 when none appears.
 */
function findFirstTermIndex(text: string, terms: readonly string[]): number {
  const lowerText = text.toLowerCase();
  const lowerTerms = terms.map((term) => term.toLowerCase());

  return findNextMatch(lowerText, lowerTerms, 0)?.index ?? -1;
}

/**
 * Finds the earliest literal occurrence of any term at or after one index.
 *
 * @param lowerText - Lowercased text to scan.
 * @param lowerTerms - Lowercased terms.
 * @param from - First character index to consider.
 * @returns The match index and length, or null when none remains.
 */
function findNextMatch(
  lowerText: string,
  lowerTerms: readonly string[],
  from: number,
): { readonly index: number; readonly length: number } | null {
  let best: { readonly index: number; readonly length: number } | null = null;

  for (const term of lowerTerms) {
    if (term.length === 0) {
      continue;
    }

    const index = lowerText.indexOf(term, from);

    if (index < 0) {
      continue;
    }

    if (best === null || index < best.index) {
      best = { index, length: term.length };
    }
  }

  return best;
}
