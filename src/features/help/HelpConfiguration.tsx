import { SyntaxStyle } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { type ReactNode, useEffect, useMemo } from "react";
import { useConfig } from "@/app/hooks/useConfig";
import { useKeymap } from "@/app/hooks/useKeymap";
import { useTheme } from "@/app/hooks/useTheme";
import type { ConfigFileKey } from "@/domain/config/config.types";
import { combineConfigurationWarnings } from "@/domain/config/config.warnings";
import { formatBinding } from "@/domain/keymap/keymap.describe";
import type { ResolvedTheme } from "@/domain/theme/theme.types";
import {
  HELP_ACTIVE_THEME_LABEL,
  HELP_CONFIG_LABEL,
  HELP_FIELD_NOTE,
  HELP_FILE_KEY_LABELS,
  HELP_FILE_NOT_PRESENT,
  HELP_FORM_NOTE_PREFIX,
  HELP_FORM_NOTE_SUFFIX,
  HELP_FORM_SUBMIT_SEPARATOR,
  HELP_FORM_SUBMIT_UNBOUND,
  HELP_KEYBINDINGS_LABEL,
  HELP_LOAD_STATUS_LABEL,
  HELP_MAX_WARNINGS,
  HELP_MORE_WARNINGS_PREFIX,
  HELP_MORE_WARNINGS_SUFFIX,
  HELP_RELOAD_NOTE,
  HELP_RELOAD_NOTE_ID,
  HELP_SEARCH_NOTE,
  HELP_THEME_FILE_LABEL,
} from "@/features/help/HelpConfiguration.constants";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";

/**
 * Renders the help Configuration section.
 *
 * The section is read-only. It shows the resolved `config.json`, `keybindings.json`, and
 * `theme.json` paths, the per-file load status, the active theme, and the bounded configuration and
 * theme warnings with the `[!]` marker, so an absent file reads as "not present" rather than as an
 * error. Theme warnings carry a `Theme:` prefix and share the same bounded count as configuration
 * warnings, which is the same combined list the top bar and the console report.
 * It then documents the three input modes, including that a single-line form keeps native Enter, a
 * multiline form submits with `form.submit` and its effective keys, and Tab indents inside a
 * multiline field. The reload note is a `<markdown>` block, which points at the command palette
 * entry point instead of offering an editing control help does not own.
 *
 * @returns The Configuration section body.
 */
export function HelpConfiguration(): ReactNode {
  const tokens = useTokens();
  const config = useConfig();
  const theme = useTheme();
  const keymap = useKeymap();
  const notesStyle = useHelpNotesStyle();
  const allWarnings = combineConfigurationWarnings(config.warnings, theme.warnings);
  const warnings = allWarnings.slice(0, HELP_MAX_WARNINGS);
  const omitted = Math.max(0, allWarnings.length - warnings.length);
  const rows = buildConfigurationRows(config, theme);

  return (
    <box flexDirection="column" flexShrink={0} paddingLeft={1}>
      {rows.map((row) => (
        <text key={row.label} wrapMode="none">
          <span fg={tokens.muted}>{`${row.label}: `}</span>
          <span fg={tokens.text}>{row.value}</span>
        </text>
      ))}
      {warnings.map((warning) => (
        <text key={warning} fg={tokens.warning} wrapMode="none">
          {`${ICONS.warningMarker} ${warning}`}
        </text>
      ))}
      {omitted === 0 ? null : (
        <text fg={tokens.muted} wrapMode="none">
          {`${HELP_MORE_WARNINGS_PREFIX} ${omitted} ${HELP_MORE_WARNINGS_SUFFIX}`}
        </text>
      )}
      <text fg={tokens.muted} wrapMode="word">
        {HELP_FIELD_NOTE}
      </text>
      <text fg={tokens.muted} wrapMode="word">
        {HELP_SEARCH_NOTE}
      </text>
      <text fg={tokens.muted} wrapMode="word">
        {readFormNote(keymap)}
      </text>
      <markdown
        id={HELP_RELOAD_NOTE_ID}
        content={HELP_RELOAD_NOTE}
        fg={tokens.muted}
        syntaxStyle={notesStyle}
      />
    </box>
  );
}

/**
 * Builds the resolved path, load status, and active theme rows.
 *
 * @param config - Configuration context value.
 * @param theme - Active resolved theme.
 * @returns The label and value of each configuration row.
 */
function buildConfigurationRows(
  config: ReturnType<typeof useConfig>,
  theme: ResolvedTheme,
): readonly { readonly label: string; readonly value: string }[] {
  return [
    { label: HELP_CONFIG_LABEL, value: config.paths.config ?? HELP_FILE_NOT_PRESENT },
    { label: HELP_KEYBINDINGS_LABEL, value: config.paths.keybindings ?? HELP_FILE_NOT_PRESENT },
    { label: HELP_THEME_FILE_LABEL, value: config.paths.theme ?? HELP_FILE_NOT_PRESENT },
    { label: HELP_LOAD_STATUS_LABEL, value: readLoadStatus(config) },
    { label: HELP_ACTIVE_THEME_LABEL, value: `${theme.label} (${theme.name})` },
  ];
}

/**
 * Reads the load status of the configuration files.
 *
 * Before the loader reports any file outcome, the merge status of the main file is the only known
 * state, so it is shown alone instead of inventing per-file rows.
 *
 * @param config - Configuration context value.
 * @returns A readable per-file status line.
 */
function readLoadStatus(config: ReturnType<typeof useConfig>): string {
  if (config.files.length === 0) {
    return config.status;
  }

  return config.files.map((file) => `${readFileLabel(file.key)}: ${file.status}`).join(", ");
}

/**
 * Reads the display name of one configuration file.
 *
 * @param key - File key reported by the loader.
 * @returns The file name used in the status line.
 */
function readFileLabel(key: ConfigFileKey): string {
  return HELP_FILE_KEY_LABELS[key] ?? key;
}

/**
 * Builds the `form` input-mode note with the effective submit keys.
 *
 * @param keymap - Resolved keymap.
 * @returns The note text, including the effective `form.submit` keys.
 */
function readFormNote(keymap: ReturnType<typeof useKeymap>): string {
  const keys = [
    ...new Set((keymap.bindings.get("form.submit") ?? []).map((binding) => formatBinding(binding))),
  ];
  const label =
    keys.length === 0 ? HELP_FORM_SUBMIT_UNBOUND : keys.join(HELP_FORM_SUBMIT_SEPARATOR);

  return `${HELP_FORM_NOTE_PREFIX} (${label})${HELP_FORM_NOTE_SUFFIX}`;
}

/**
 * Creates and owns the syntax style the reload note requires.
 *
 * `MarkdownRenderable` requires a syntax style bound to the renderer. One `default` style keeps the
 * note in the muted token, and the style is released when its renderer or the token changes, so a
 * theme switch cannot leak the previous style.
 *
 * @returns The syntax style bound to the active renderer and theme.
 */
function useHelpNotesStyle(): SyntaxStyle {
  const renderer = useRenderer();
  const tokens = useTokens();
  const style = useMemo(
    () => SyntaxStyle.fromStyles({ default: { fg: tokens.muted } }, renderer.nativeScene),
    [renderer, tokens.muted],
  );

  useEffect(
    () => () => {
      style.destroy();
    },
    [style],
  );

  return style;
}
