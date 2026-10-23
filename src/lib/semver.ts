import type { ParsedVersion } from "./semver.types";

/** Matches a release version with optional prerelease and build metadata, with an optional `v` prefix. */
const VERSION_PATTERN =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/** Matches a prerelease identifier that is entirely numeric. */
const NUMERIC_IDENTIFIER_PATTERN = /^\d+$/;

/**
 * Parses a semantic version string.
 *
 * Accepts an optional `v` prefix, optional prerelease identifiers, and optional build metadata.
 * The input must not contain leading or trailing whitespace, matching strict semantic version
 * parsing. A numeric prerelease identifier with a leading zero is invalid, and a release part
 * above `Number.MAX_SAFE_INTEGER` is rejected rather than losing precision. Invalid input returns
 * `null` rather than throwing.
 *
 * @param value - The version string to parse.
 * @returns The parsed version, or `null` when the input is not a valid semantic version.
 */
export function parseVersion(value: string): ParsedVersion | null {
  const match = VERSION_PATTERN.exec(value);

  if (!match) {
    return null;
  }

  const [, majorText, minorText, patchText, prereleaseText, buildText] = match;

  if (!majorText || !minorText || !patchText) {
    return null;
  }

  const major = parseReleasePart(majorText);
  const minor = parseReleasePart(minorText);
  const patch = parseReleasePart(patchText);

  if (major === null || minor === null || patch === null) {
    return null;
  }

  const prerelease = prereleaseText ? prereleaseText.split(".") : [];

  if (!prerelease.every(isValidPrereleaseIdentifier)) {
    return null;
  }

  return {
    major,
    minor,
    patch,
    prerelease,
    build: buildText ? buildText.split(".") : [],
  };
}

/**
 * Compares two semantic version strings by precedence.
 *
 * Build metadata is ignored. A release version is greater than any prerelease version, and
 * prerelease identifiers are compared by the rules in the semantic version specification.
 *
 * @param left - The left version string.
 * @param right - The right version string.
 * @returns `-1` when left is lower, `1` when left is higher, `0` when equal, or `null` when
 * either input is invalid.
 */
export function compareVersions(left: string, right: string): number | null {
  const leftVersion = parseVersion(left);
  const rightVersion = parseVersion(right);

  if (!leftVersion || !rightVersion) {
    return null;
  }

  const releaseComparison = compareReleaseParts(leftVersion, rightVersion);

  if (releaseComparison !== 0) {
    return releaseComparison;
  }

  return comparePrerelease(leftVersion.prerelease, rightVersion.prerelease);
}

/**
 * Determines whether a candidate version is strictly newer than a current version.
 *
 * Invalid input is treated as no update, so a malformed local or registry version never claims
 * that an update is available.
 *
 * @param candidate - The candidate version, normally the latest published version.
 * @param current - The current running version.
 * @returns `true` only when both versions are valid and the candidate has higher precedence.
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) === 1;
}

/**
 * Parses a major, minor, or patch number.
 *
 * @param part - The numeric text to parse.
 * @returns The safe integer value, or `null` for a leading zero or an unsafe integer.
 */
function parseReleasePart(part: string): number | null {
  if (part.length > 1 && part.startsWith("0")) {
    return null;
  }

  const value = Number(part);

  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Validates a prerelease identifier.
 *
 * Numeric identifiers must not contain leading zeroes, per the semantic version specification.
 * They are kept as strings so arbitrarily large numeric identifiers compare without precision
 * loss.
 *
 * @param identifier - The identifier to validate.
 * @returns `true` when the identifier is valid.
 */
function isValidPrereleaseIdentifier(identifier: string): boolean {
  if (identifier.length === 0) {
    return false;
  }

  if (!NUMERIC_IDENTIFIER_PATTERN.test(identifier)) {
    return true;
  }

  return identifier.length === 1 || !identifier.startsWith("0");
}

/**
 * Compares the major, minor, and patch parts of two parsed versions.
 *
 * @param left - The left parsed version.
 * @param right - The right parsed version.
 * @returns `-1`, `0`, or `1` for the release-part ordering.
 */
function compareReleaseParts(left: ParsedVersion, right: ParsedVersion): number {
  return (
    compareNumbers(left.major, right.major) ||
    compareNumbers(left.minor, right.minor) ||
    compareNumbers(left.patch, right.patch)
  );
}

/**
 * Compares two prerelease identifier lists.
 *
 * An empty list is a normal release and outranks any prerelease. A shorter list wins when all
 * shared identifiers are equal.
 *
 * @param left - The left prerelease identifiers.
 * @param right - The right prerelease identifiers.
 * @returns `-1`, `0`, or `1` for the prerelease ordering.
 */
function comparePrerelease(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) {
    return comparePrereleasePresence(left.length, right.length);
  }

  return compareIdentifierLists(left, right);
}

/**
 * Orders a normal release against a prerelease.
 *
 * @param leftLength - Number of left prerelease identifiers.
 * @param rightLength - Number of right prerelease identifiers.
 * @returns `0` when both are releases, `1` when only the right is a prerelease, otherwise `-1`.
 */
function comparePrereleasePresence(leftLength: number, rightLength: number): number {
  if (leftLength === 0 && rightLength === 0) {
    return 0;
  }

  return leftLength === 0 ? 1 : -1;
}

/**
 * Compares two non-empty prerelease identifier lists.
 *
 * @param left - The left prerelease identifiers.
 * @param right - The right prerelease identifiers.
 * @returns `-1`, `0`, or `1` for the identifier-list ordering.
 */
function compareIdentifierLists(left: readonly string[], right: readonly string[]): number {
  const sharedComparison = compareSharedIdentifiers(left, right);

  if (sharedComparison !== 0) {
    return sharedComparison;
  }

  return compareNumbers(left.length, right.length);
}

/**
 * Compares the identifiers shared by two prerelease lists.
 *
 * @param left - The left prerelease identifiers.
 * @param right - The right prerelease identifiers.
 * @returns The first differing ordering, or `0` when every shared identifier is equal.
 */
function compareSharedIdentifiers(left: readonly string[], right: readonly string[]): number {
  const sharedLength = Math.min(left.length, right.length);

  for (let index = 0; index < sharedLength; index += 1) {
    const leftIdentifier = left[index];
    const rightIdentifier = right[index];

    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      return 0;
    }

    const identifierComparison = compareIdentifiers(leftIdentifier, rightIdentifier);

    if (identifierComparison !== 0) {
      return identifierComparison;
    }
  }

  return 0;
}

/**
 * Compares two prerelease identifiers.
 *
 * Numeric identifiers compare numerically by length and then lexicographically, so values above
 * `Number.MAX_SAFE_INTEGER` keep their ordering. Numeric identifiers rank below alphanumeric ones.
 *
 * @param left - The left identifier.
 * @param right - The right identifier.
 * @returns `-1`, `0`, or `1` for the identifier ordering.
 */
function compareIdentifiers(left: string, right: string): number {
  const leftIsNumeric = NUMERIC_IDENTIFIER_PATTERN.test(left);
  const rightIsNumeric = NUMERIC_IDENTIFIER_PATTERN.test(right);

  if (leftIsNumeric && rightIsNumeric) {
    return compareNumericIdentifiers(left, right);
  }

  if (leftIsNumeric !== rightIsNumeric) {
    return leftIsNumeric ? -1 : 1;
  }

  return compareText(left, right);
}

/**
 * Compares two numeric identifier strings without converting them to numbers.
 *
 * @param left - The left numeric identifier.
 * @param right - The right numeric identifier.
 * @returns `-1`, `0`, or `1` for the numeric ordering.
 */
function compareNumericIdentifiers(left: string, right: string): number {
  if (left.length !== right.length) {
    return compareNumbers(left.length, right.length);
  }

  return compareText(left, right);
}

/**
 * Compares two strings lexicographically.
 *
 * @param left - The left string.
 * @param right - The right string.
 * @returns `-1`, `0`, or `1` for the string ordering.
 */
function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

/**
 * Returns the ordering of two numbers as `-1`, `0`, or `1`.
 *
 * @param left - The left number.
 * @param right - The right number.
 * @returns The ordering of the two numbers.
 */
function compareNumbers(left: number, right: number): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}
