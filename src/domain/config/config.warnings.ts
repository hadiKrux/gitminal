/** Maximum warnings kept in one bounded list; the rest collapse into one counted line. */
export const MAX_CONFIG_WARNINGS = 12;

/** Prefix that marks a warning as coming from theme resolution. */
export const THEME_WARNING_PREFIX = "Theme: ";

/**
 * Caps a configuration warning list for display.
 *
 * Configuration problems are bounded by the number of fields, but a hand-written file can still
 * produce dozens of unknown-field warnings. Theme warnings share the same budget, so the combined
 * surface never renders an unbounded list. The kept warnings stay exact and the remainder is
 * summarized, so the status strip and Help stay bounded.
 *
 * @param warnings - Warnings in discovery order.
 * @returns At most `MAX_CONFIG_WARNINGS` lines.
 */
export function boundConfigWarnings(warnings: readonly string[]): readonly string[] {
  if (warnings.length <= MAX_CONFIG_WARNINGS) {
    return Object.freeze([...warnings]);
  }

  const kept = warnings.slice(0, MAX_CONFIG_WARNINGS - 1);
  const omitted = warnings.length - kept.length;

  return Object.freeze([...kept, `${omitted} more configuration warnings were omitted.`]);
}

/**
 * Combines configuration and theme warnings into one bounded, distinguishable list.
 *
 * Configuration warnings keep their own wording because each one already names the file and field it
 * came from. Theme warnings are prefixed so the top bar, the console notice, and Help always say
 * whether a message came from `theme.json` or from theme resolution. The combined list is bounded
 * once, after the prefix is applied, so the counted remainder covers both sources.
 *
 * @param configWarnings - Warnings from loading and validating configuration files.
 * @param themeWarnings - Warnings produced while resolving the active theme.
 * @returns The bounded combined warning list, configuration warnings first.
 */
export function combineConfigurationWarnings(
  configWarnings: readonly string[],
  themeWarnings: readonly string[],
): readonly string[] {
  if (themeWarnings.length === 0) {
    return boundConfigWarnings(configWarnings);
  }

  return boundConfigWarnings([
    ...configWarnings,
    ...themeWarnings.map((warning) => `${THEME_WARNING_PREFIX}${warning}`),
  ]);
}
