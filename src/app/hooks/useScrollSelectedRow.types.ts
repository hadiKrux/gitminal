/** A surface that can reveal one of its own scroll children. */
export interface ScrollChildIntoViewTarget {
  /** Scrolls the named child into the viewport. */
  readonly scrollChildIntoView: (childId: string) => void;
}
