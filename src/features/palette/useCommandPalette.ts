import { useEffect } from "react";
import { registerInputMode } from "@/app/hooks/inputMode.registry";
import { formatBinding } from "@/domain/keymap/keymap.describe";
import type { ResolvedKeymap } from "@/domain/keymap/keymap.types";
import {
  PALETTE_ACTIVATE_ACTION_ID,
  PALETTE_CLOSE_ACTION_ID,
  PALETTE_NEXT_FIELD_ACTION_ID,
  PALETTE_SEARCH_INPUT_ID,
} from "@/features/palette/CommandPalette.constants";
import { PALETTE_UNBOUND_LABEL } from "@/features/palette/CommandRow.constants";
import type {
  PaletteHandle,
  PaletteHintKeys,
  UseCommandPaletteOptions,
} from "@/features/palette/useCommandPalette.types";
import { usePaletteCapture } from "@/features/palette/usePaletteCapture";
import { usePaletteDispatch } from "@/features/palette/usePaletteDispatch";
import { usePaletteKeys } from "@/features/palette/usePaletteKeys";
import { usePaletteView } from "@/features/palette/usePaletteView";

/**
 * Owns the command palette's captured entries, filtering, recents, and dispatch.
 *
 * The capture, the rendered rows and highlight, the activation path, and the key registrations each
 * live in their own sibling hook, so this hook only joins them. The entries are captured once when
 * the overlay opens, and typing never re-derives a command target.
 *
 * @param options - Overlay close callback that accepts a post-restore completion.
 * @returns The options, highlight, hints, and select callbacks the view renders.
 */
export function useCommandPalette(options: UseCommandPaletteOptions): PaletteHandle {
  const capture = usePaletteCapture();
  const view = usePaletteView(capture.entries, capture.recentCommandIds);
  const dispatch = usePaletteDispatch(capture, options);

  useEffect(() => registerInputMode(PALETTE_SEARCH_INPUT_ID, "search"), []);

  usePaletteKeys({ view, activate: dispatch.activate, options });

  return {
    query: view.query,
    setQuery: view.setQuery,
    options: view.options,
    highlightedIndex: view.highlightedIndex,
    matchCount: view.matchCount,
    optionRows: view.optionRows,
    hints: readHintKeys(capture.keymap),
    highlightOption: view.highlightOption,
    selectValue: dispatch.selectValue,
  };
}

/**
 * Reads the shortcuts the modal footer advertises.
 *
 * @param keymap - Resolved keymap.
 * @returns The effective key labels for run, close, and next field.
 */
function readHintKeys(keymap: ResolvedKeymap): PaletteHintKeys {
  return {
    activate: readFirstBinding(keymap, PALETTE_ACTIVATE_ACTION_ID),
    close: readFirstBinding(keymap, PALETTE_CLOSE_ACTION_ID),
    nextField: readFirstBinding(keymap, PALETTE_NEXT_FIELD_ACTION_ID),
  };
}

/**
 * Reads the first effective binding of one action.
 *
 * @param keymap - Resolved keymap.
 * @param actionId - Action id.
 * @returns The formatted binding, or the "Unbound" label.
 */
function readFirstBinding(keymap: ResolvedKeymap, actionId: string): string {
  const binding = keymap.bindings.get(actionId)?.[0];

  return binding === undefined ? PALETTE_UNBOUND_LABEL : formatBinding(binding);
}
