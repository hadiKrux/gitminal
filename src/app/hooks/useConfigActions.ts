import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAction } from "@/app/hooks/useAction";
import { useConfig } from "@/app/hooks/useConfig";
import { useConsoleLog } from "@/app/hooks/useConsoleLog";
import { useStatus } from "@/app/hooks/useStatus";
import { useTheme } from "@/app/hooks/useTheme";
import type { ConfigReloadResult } from "@/app/providers/ConfigProvider.types";
import type { TransientStatus } from "@/app/providers/StatusProvider.types";
import { combineConfigurationWarnings } from "@/domain/config/config.warnings";
import { createConsoleEntryId, formatNoticeEntry } from "@/domain/console/console.format";

/** Action id that reloads the configuration; the same id labels its console notices. */
const RELOAD_ACTION_ID = "app.reloadConfig";

/** Operation label shown on every configuration console entry. */
const CONFIG_OPERATION_LABEL = "Configuration";

/** Status shown when a reload applies without warnings. */
const RELOAD_SUCCESS_MESSAGE = "Configuration reloaded";

/** Status shown when a reload fails and the loader reported no warning of its own. */
const RELOAD_FAILED_MESSAGE = "Configuration reload failed";

/** Separator used to flatten several warnings into one single-line console notice. */
const WARNING_SEPARATOR = " | ";

/**
 * Registers the configuration actions and reports configuration and theme warnings.
 *
 * `app.reloadConfig` is a global action with exactly one owner, this app-layer hook, and it is
 * unbound by default so it stays reachable from the palette and Help. A reload re-reads the three
 * files through `ConfigProvider`; success shows a transient status and the providers re-render with
 * the new effective values, which is what refreshes the effective bindings and the theme. A failure
 * or any load warning is a non-blocking warning status plus one console notice, never an overlay.
 *
 * Theme resolution warnings arrive through `ThemeProvider` rather than the configuration snapshot,
 * so this hook combines both sources before reporting. Theme warnings keep a `Theme:` prefix so the
 * status strip and the console stay distinguishable, and the combined list is reported once per
 * distinct set. Reporting reads the same combined list Help renders, so neither surface can report a
 * warning the other already reported.
 */
export function useConfigActions(): void {
  const config = useConfig();
  const theme = useTheme();
  const { setStatus } = useStatus();
  const consoleLog = useConsoleLog();
  const reported = useRef<string | null>(null);
  const [reloadResult, setReloadResult] = useState<ConfigReloadResult | null>(null);
  const warnings = useMemo(
    () => combineConfigurationWarnings(config.warnings, theme.warnings),
    [config.warnings, theme.warnings],
  );

  /**
   * Reports one warning set through the status strip and the console.
   *
   * @param messages - Non-empty combined warning list.
   */
  const reportWarnings = useCallback(
    (messages: readonly string[]): void => {
      consoleLog.append(
        formatNoticeEntry({
          id: createConsoleEntryId(),
          at: Date.now(),
          commandId: RELOAD_ACTION_ID,
          operationLabel: CONFIG_OPERATION_LABEL,
          message: messages.join(WARNING_SEPARATOR),
        }),
      );
      setStatus({ kind: "warning", message: messages[0] ?? RELOAD_FAILED_MESSAGE });
    },
    [consoleLog, setStatus],
  );

  useEffect(() => {
    if (warnings.length === 0) {
      // A clean configuration re-arms reporting, so a warning that returns after a fix is visible
      // again instead of being suppressed by its earlier signature.
      reported.current = null;

      return;
    }

    const signature = warnings.join(WARNING_SEPARATOR);

    if (reported.current === signature) {
      return;
    }

    reported.current = signature;
    reportWarnings(warnings);
  }, [reportWarnings, warnings]);

  useEffect(() => {
    if (reloadResult === null) {
      return;
    }

    // The render that follows a reload already carries the new configuration and the theme warnings
    // resolved from it, so the outcome is reported once here and the trigger is consumed.
    setStatus(readReloadStatus(reloadResult, warnings));
    setReloadResult(null);
  }, [reloadResult, setStatus, warnings]);

  useAction(RELOAD_ACTION_ID, { scope: "global", owner: "app" }, () => {
    void (async () => {
      setReloadResult(await config.reload());
    })();
  });
}

/**
 * Reads the status one settled reload reports.
 *
 * A warning still present after the reload wins, whether it came from the reload itself or from the
 * theme resolution that ran against it, so a reload never reports success while a warning is active.
 * A failed reload without any warning falls back to the generic failure message.
 *
 * @param result - Outcome of the reload.
 * @param warnings - Combined configuration and theme warnings for the post-reload render.
 * @returns The transient status to show.
 */
function readReloadStatus(
  result: ConfigReloadResult,
  warnings: readonly string[],
): TransientStatus {
  const warning = warnings[0] ?? result.warnings[0];

  if (warning !== undefined) {
    return { kind: "warning", message: warning };
  }

  return result.ok
    ? { kind: "success", message: RELOAD_SUCCESS_MESSAGE }
    : { kind: "warning", message: RELOAD_FAILED_MESSAGE };
}
