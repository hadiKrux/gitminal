/**
 * A semantic version split into its comparable parts.
 *
 * Build metadata is kept for completeness but never participates in precedence.
 */
export interface ParsedVersion {
  /** Major version number. */
  major: number;
  /** Minor version number. */
  minor: number;
  /** Patch version number. */
  patch: number;
  /** Dot-separated prerelease identifiers, empty for a release version. */
  prerelease: readonly string[];
  /** Dot-separated build metadata identifiers. */
  build: readonly string[];
}
