import { useCallback } from "react";
import { useAction } from "@/app/hooks/useAction";
import { useFocusState } from "@/app/hooks/useFocusState";
import {
  PALETTE_ACTIVATE_ACTION_ID,
  PALETTE_CLOSE_ACTION_ID,
  PALETTE_SEARCH_INPUT_ID,
  PALETTE_SELECT_ID,
} from "@/features/palette/CommandPalette.constants";
import type { PaletteRow } from "@/features/palette/CommandRow.types";
import type { UseCommandPaletteOptions } from "@/features/palette/useCommandPalette.types";
import type { PaletteView } from "@/features/palette/usePaletteView";

/** Inputs accepted by `usePaletteKeys`. */
interface UsePaletteKeysInput {
  /** Query, rows, and highlight the movement keys drive. */
  readonly view: PaletteView;
  /** Runs the highlighted command. */
  readonly activate: (rows: readonly PaletteRow[], selectableIndex: number) => void;
  /** Overlay close callback. */
  readonly options: UseCommandPaletteOptions;
}

/**
 * Registers the palette's overlay-scoped keys.
 *
 * Up, Down, Page Up, Page Down, Home, and End move the highlight, Enter runs the highlighted
 * command, Esc closes, and Tab toggles between the search field and the result list. The search field
 * declares the `search` input mode, so navigation keys route to the result list while printable keys
 * keep editing the query. Nothing is registered globally: the palette never opens itself.
 *
 * @param input - View state, the activation handler, and the close callback.
 */
export function usePaletteKeys(input: UsePaletteKeysInput): void {
  const focus = useFocusState();
  const { view, activate, options } = input;
  const { highlightedIndex, move, moveToFirst, moveToLast, optionRows, rows } = view;

  /**
   * Moves native focus between the search field and the result list.
   *
   * Tab and Shift+Tab both toggle between the two controls, because the palette has exactly two
   * focusable elements. When focus is elsewhere, the direction chooses the fallback target.
   *
   * @param direction - 1 for next, -1 for previous.
   */
  const focusPaletteField = useCallback(
    (direction: 1 | -1): void => {
      const current = focus.state.focusedRenderableId;

      if (current === PALETTE_SEARCH_INPUT_ID) {
        focus.focusRenderable(PALETTE_SELECT_ID);

        return;
      }

      if (current === PALETTE_SELECT_ID) {
        focus.focusRenderable(PALETTE_SEARCH_INPUT_ID);

        return;
      }

      focus.focusRenderable(direction === 1 ? PALETTE_SELECT_ID : PALETTE_SEARCH_INPUT_ID);
    },
    [focus],
  );

  useAction(PALETTE_ACTIVATE_ACTION_ID, { scope: "overlay" }, () => {
    activate(rows, highlightedIndex);
  });
  useAction("nav.up", { scope: "overlay" }, () => {
    move(-1);
  });
  useAction("nav.down", { scope: "overlay" }, () => {
    move(1);
  });
  useAction("nav.pageUp", { scope: "overlay" }, () => {
    move(-optionRows);
  });
  useAction("nav.pageDown", { scope: "overlay" }, () => {
    move(optionRows);
  });
  useAction("nav.first", { scope: "overlay" }, moveToFirst);
  useAction("nav.last", { scope: "overlay" }, moveToLast);
  useAction(PALETTE_CLOSE_ACTION_ID, { scope: "overlay" }, () => {
    options.onClose();
  });
  useAction("focus.next", { scope: "overlay" }, () => {
    focusPaletteField(1);
  });
  useAction("focus.previous", { scope: "overlay" }, () => {
    focusPaletteField(-1);
  });
}
