import { useActions } from "@/app/hooks/useAction";
import type { ConsoleActionHandlers } from "@/features/console/useConsole.types";

/** Scope every console action registers in. */
const CONSOLE_SCOPE = Object.freeze({ scope: "console" as const });

/**
 * Registers every console-scoped action handler.
 *
 * The console owns only `console.clear` and its `nav.*` handlers. `nav.activate` toggles the selected
 * entry's output, so a keyboard-first user never needs a mouse to expand or collapse stdout and
 * stderr. `app.*`, `focus.*`, and `overlay.close` stay single global registrations in the app and
 * shell layers.
 *
 * @param handlers - Cursor and clear operations registered by the console.
 */
export function useConsoleActions(handlers: ConsoleActionHandlers): void {
  useActions([
    { actionId: "console.clear", options: CONSOLE_SCOPE, handler: handlers.requestClear },
    { actionId: "nav.up", options: CONSOLE_SCOPE, handler: handlers.moveUp },
    { actionId: "nav.down", options: CONSOLE_SCOPE, handler: handlers.moveDown },
    { actionId: "nav.pageUp", options: CONSOLE_SCOPE, handler: handlers.pageUp },
    { actionId: "nav.pageDown", options: CONSOLE_SCOPE, handler: handlers.pageDown },
    { actionId: "nav.first", options: CONSOLE_SCOPE, handler: handlers.selectFirst },
    { actionId: "nav.last", options: CONSOLE_SCOPE, handler: handlers.selectLast },
    { actionId: "nav.activate", options: CONSOLE_SCOPE, handler: handlers.toggleSelected },
  ]);
}
