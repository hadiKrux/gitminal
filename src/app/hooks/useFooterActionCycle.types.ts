/** Inputs accepted by `useFooterActionCycle`. */
export interface FooterActionCycleInput {
  /** Number of visible footer actions. */
  readonly actionCount: number;
  /** Action focused when the modal mounts. Defaults to the first action. */
  readonly initialIndex?: number;
  /**
   * Runs the focused action.
   *
   * @param index - Index of the focused action.
   */
  readonly onActivate: (index: number) => void;
}

/** Footer cycle state and operations exposed to a modal. */
export interface FooterActionCycle {
  /** Index of the focused action. */
  readonly focusedAction: number;
  /** Focuses one action index. */
  readonly focusAction: (index: number) => void;
  /** Runs the focused action through the caller's rule. */
  activateFocusedAction(): void;
}
