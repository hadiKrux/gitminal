/**
 * View state of the help modal: the search text and the row cursor.
 *
 * The two live together because every query change returns the cursor to the first match, and a
 * single transition keeps them from disagreeing for one render.
 */
export interface HelpViewState {
  /** Text typed into the search field. */
  readonly query: string;
  /** Index of the highlighted row inside the visible rows. */
  readonly selectedIndex: number;
}

/** Every transition the help view supports. */
export type HelpViewAction =
  | { readonly type: "setQuery"; readonly query: string }
  | { readonly type: "clearQuery" }
  | { readonly type: "setIndex"; readonly index: number };

/** View state before the user has typed or moved the cursor. */
export const INITIAL_HELP_VIEW_STATE: HelpViewState = Object.freeze({
  query: "",
  selectedIndex: 0,
});

/**
 * Applies one help view transition.
 *
 * Every query change resets the cursor, so a filtered list always starts at its first match instead
 * of pointing at a row that the previous query left under the cursor.
 *
 * @param state - Current view state.
 * @param action - Transition to apply.
 * @returns The next view state.
 */
export function reduceHelpView(state: HelpViewState, action: HelpViewAction): HelpViewState {
  switch (action.type) {
    case "setQuery":
      return { query: action.query, selectedIndex: 0 };
    case "clearQuery":
      return { query: "", selectedIndex: 0 };
    case "setIndex":
      return { query: state.query, selectedIndex: action.index };
  }
}
