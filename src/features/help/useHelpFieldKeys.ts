import { useCallback } from "react";
import { useAction } from "@/app/hooks/useAction";
import { useFocusState } from "@/app/hooks/useFocusState";
import {
  HELP_CLOSE_ACTION_ID,
  HELP_MODAL_ID,
  HELP_SEARCH_ACTION_ID,
  HELP_SEARCH_INPUT_ID,
} from "@/features/help/HelpModal.constants";

/** Inputs accepted by `useHelpFieldKeys`. */
interface UseHelpFieldKeysInput {
  /** Text typed into the search field. */
  readonly query: string;
  /** Clears the search and returns the cursor to the first row. */
  readonly clearSearch: () => void;
  /** Closes the overlay entry that renders help. */
  readonly onClose: () => void;
}

/** Handlers the help modal and its footer reuse. */
export interface HelpFieldActions {
  /** Focuses the help search field. */
  readonly focusSearch: () => void;
}

/**
 * Registers the help modal's field keys and owns its focus movement.
 *
 * The search key focuses the field, Tab moves between the search field and the row list, and Esc
 * clears the search before it closes, so the first Esc never loses the user's place. Help has exactly
 * two focusable controls, so both Tab directions toggle between them.
 *
 * @param input - Current query, its clear writer, and the overlay close callback.
 * @returns The focus handlers the modal reuses.
 */
export function useHelpFieldKeys(input: UseHelpFieldKeysInput): HelpFieldActions {
  const focus = useFocusState();
  const { query, clearSearch, onClose } = input;

  /** Focuses the help search field. */
  const focusSearch = useCallback((): void => {
    focus.focusRenderable(HELP_SEARCH_INPUT_ID);
  }, [focus]);

  /** Moves native focus between the search field and the row list. */
  const moveFieldFocus = useCallback((): void => {
    const inSearch = focus.state.focusedRenderableId === HELP_SEARCH_INPUT_ID;

    focus.focusRenderable(inSearch ? HELP_MODAL_ID : HELP_SEARCH_INPUT_ID);
  }, [focus]);

  /** Clears the search when it has text, otherwise closes help. */
  const clearOrClose = useCallback((): void => {
    if (query.length > 0) {
      clearSearch();

      return;
    }

    onClose();
  }, [clearSearch, onClose, query.length]);

  useAction(HELP_SEARCH_ACTION_ID, { scope: "overlay" }, focusSearch);
  useAction(HELP_CLOSE_ACTION_ID, { scope: "overlay" }, clearOrClose);
  useAction("focus.next", { scope: "overlay" }, moveFieldFocus);
  useAction("focus.previous", { scope: "overlay" }, moveFieldFocus);

  return { focusSearch };
}
