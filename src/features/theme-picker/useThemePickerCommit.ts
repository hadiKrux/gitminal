import { useCallback } from "react";
import { useConfig } from "@/app/hooks/useConfig";
import { useStatus } from "@/app/hooks/useStatus";
import type { ThemeWriteResult } from "@/domain/config/config.types";
import { writeTheme } from "@/domain/config/config.writer";
import type { ThemeName } from "@/domain/theme/theme.types";
import {
  THEME_SAVE_FAILED_MESSAGE,
  THEME_SAVED_MESSAGE_PREFIX,
} from "@/features/theme-picker/ThemePicker.constants";
import type {
  ThemePickerCommit,
  ThemePickerRow,
  UseThemePickerCommitOptions,
} from "@/features/theme-picker/useThemePicker.types";

/**
 * Owns the picker's apply and cancel paths, including the persistence write.
 *
 * Apply commits the highlighted theme for the session, closes, and writes the `theme` field in the
 * background, so a slow or failing write never blocks the close. Cancel restores the theme that was
 * active when the picker opened. Both paths settle the picker first, so the unmount guard cannot
 * restore the previous theme after the user has already chosen one.
 *
 * @param input - Overlay close callback, persistence override, and the picker view state.
 * @returns The apply and cancel handlers.
 */
export function useThemePickerCommit(input: UseThemePickerCommitOptions): ThemePickerCommit {
  const config = useConfig();
  const { setStatus } = useStatus();
  const { options, state } = input;
  const { controls, highlightedIndex, previousName, rows, settle } = state;

  /** Persists one row and reports the outcome without blocking the close. */
  const persistRow = useCallback(
    (row: ThemePickerRow): void => {
      const persist = options.persist ?? writeConfiguredTheme;

      void persist(row.name, config.paths.config)
        .then((result) => {
          setStatus(
            result.ok
              ? { kind: "success", message: `${THEME_SAVED_MESSAGE_PREFIX} ${row.label}` }
              : { kind: "warning", message: THEME_SAVE_FAILED_MESSAGE },
          );
        })
        .catch(() => {
          setStatus({ kind: "warning", message: THEME_SAVE_FAILED_MESSAGE });
        });
    },
    [config.paths.config, options.persist, setStatus],
  );

  /** Commits the highlighted theme, persists it, and closes the picker. */
  const apply = useCallback((): void => {
    const row = rows[highlightedIndex];

    if (row === undefined) {
      return;
    }

    settle();
    controls.commit(row.name);
    options.onClose();
    persistRow(row);
  }, [controls, highlightedIndex, options, persistRow, rows, settle]);

  /** Restores the theme that was active when the picker opened and closes it. */
  const cancel = useCallback((): void => {
    settle();
    controls.restore(previousName);
    options.onClose();
  }, [controls, options, previousName, settle]);

  return { apply, cancel };
}

/**
 * Writes the selected theme through the shared configuration writer.
 *
 * @param name - Theme name to persist.
 * @param configPath - Resolved `config.json` path, or `null` when none could be resolved.
 * @returns Whether the write succeeded, with a reason on failure.
 */
async function writeConfiguredTheme(
  name: ThemeName,
  configPath: string | null,
): Promise<ThemeWriteResult> {
  if (configPath === null) {
    return { ok: false, reason: "No config.json location could be resolved" };
  }

  return await writeTheme(name, { configPath });
}
