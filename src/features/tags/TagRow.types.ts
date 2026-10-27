/** Theme token name that colors a tag scope indicator. */
export type TagScopeIndicatorToken = "tag" | "warning" | "muted";

/** One rendered tag scope indicator: fixed-width bracketed text plus the token that colors it. */
export interface TagScopeIndicator {
  /** Bracketed two-slot text, always the fixed indicator width in cells. */
  readonly text: string;
  /** Theme token that colors the indicator. */
  readonly token: TagScopeIndicatorToken;
}
