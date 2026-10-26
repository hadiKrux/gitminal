import { useEffect } from "react";
import { registerInputMode } from "@/app/hooks/inputMode.registry";
import { registerInputEscapeClear } from "@/app/hooks/useInputEscapeClear";
import { formatBinding } from "@/domain/keymap/keymap.describe";
import type { ResolvedKeymap } from "@/domain/keymap/keymap.types";
import {
  HELP_CLOSE_ACTION_ID,
  HELP_MODAL_ID,
  HELP_SEARCH_ACTION_ID,
  HELP_SEARCH_INPUT_ID,
} from "@/features/help/HelpModal.constants";
import { HELP_UNBOUND_LABEL } from "@/features/help/HelpRow.constants";
import { HELP_NAVIGATE_ACTION_ID } from "@/features/help/useHelp.constants";
import type { HelpHandle, HelpHintKeys, UseHelpOptions } from "@/features/help/useHelp.types";
import { useHelpFieldKeys } from "@/features/help/useHelpFieldKeys";
import { useHelpListKeys } from "@/features/help/useHelpListKeys";
import { useHelpModel } from "@/features/help/useHelpModel";
import { useHelpSectionsState } from "@/features/help/useHelpSectionsState";
import { useHelpViewState } from "@/features/help/useHelpViewState";

/**
 * Owns the help modal's query, cursor, collapse state, search, and key handling.
 *
 * The view state, the catalogue and row cursor, the collapse state, and the key registrations each
 * live in their own sibling hook, so this hook only joins them. Filtering runs over the settled
 * query, so the row list and the match count always describe the same text; clearing the field
 * bypasses the debounce delay so the full list returns in the same render rather than after one
 * quiet interval. Esc clears the search and then closes on a second press. Every handler is
 * overlay-scoped, and the hook registers no global action: the app layer owns the `app.help` toggle
 * that opened the modal.
 *
 * @param options - Overlay close callback.
 * @returns The query, ordered sections, row cursor, hints, and callbacks the modal renders.
 */
export function useHelp(options: UseHelpOptions): HelpHandle {
  const sections = useHelpSectionsState();
  const view = useHelpViewState();
  const model = useHelpModel({
    activeQuery: view.activeQuery,
    collapsedSections: sections.collapsedSections,
    selectedIndex: view.selectedIndex,
    setSelectedIndex: view.setSelectedIndex,
  });
  const field = useHelpFieldKeys({
    query: view.query,
    clearSearch: view.clearSearch,
    onClose: options.onClose,
  });

  useEffect(() => registerInputMode(HELP_SEARCH_INPUT_ID, "search"), []);
  useEffect(
    () => registerClearOnEscape(view.query.length, view.clearSearch),
    [view.clearSearch, view.query.length],
  );

  useHelpListKeys({
    selection: model,
    sections: model.sections,
    setSectionCollapsed: sections.setSectionCollapsed,
  });

  return {
    query: view.query,
    hasQuery: view.hasQuery,
    setQuery: view.setQuery,
    sections: model.sections,
    selectedActionId: model.selectedActionId,
    matchCount: model.matchCount,
    hints: readHintKeys(model.keymap),
    focusSearch: field.focusSearch,
    toggleSection: sections.toggleSection,
    selectRow: model.selectRow,
  };
}

/**
 * Registers the first-Esc clear for the help surface while the search has text.
 *
 * The search field and the modal frame both consume the first Esc, so the search clears from
 * wherever focus sits and the next Esc closes help through the app's overlay close path.
 *
 * @param queryLength - Current query length; an empty query registers nothing.
 * @param clearSearch - Query writer that returns the cursor to the first row.
 * @returns A cleanup function, or undefined when the query is empty.
 */
function registerClearOnEscape(
  queryLength: number,
  clearSearch: () => void,
): (() => void) | undefined {
  if (queryLength === 0) {
    return undefined;
  }

  const cleanups = [
    registerInputEscapeClear(HELP_SEARCH_INPUT_ID, clearSearch),
    registerInputEscapeClear(HELP_MODAL_ID, clearSearch),
  ];

  return () => {
    for (const cleanup of cleanups) {
      cleanup();
    }
  };
}

/**
 * Reads the effective keys the help footer advertises.
 *
 * @param keymap - Resolved keymap.
 * @returns The search, close, and navigation key labels.
 */
function readHintKeys(keymap: ResolvedKeymap): HelpHintKeys {
  return {
    search: readFirstBinding(keymap, HELP_SEARCH_ACTION_ID),
    close: readFirstBinding(keymap, HELP_CLOSE_ACTION_ID),
    navigate: readFirstBinding(keymap, HELP_NAVIGATE_ACTION_ID),
  };
}

/**
 * Reads the first effective binding of one action.
 *
 * @param keymap - Resolved keymap.
 * @param actionId - Action id.
 * @returns The formatted binding, or the Unbound label.
 */
function readFirstBinding(keymap: ResolvedKeymap, actionId: string): string {
  const binding = keymap.bindings.get(actionId)?.[0];

  return binding === undefined ? HELP_UNBOUND_LABEL : formatBinding(binding);
}
