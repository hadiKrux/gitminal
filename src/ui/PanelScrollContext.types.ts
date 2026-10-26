/**
 * Scroll access one sidebar panel body receives from its shell frame.
 *
 * The shell owns the single `<scrollbox>` of a panel, so the body cannot reach the scroll container
 * itself. `SidebarPanelFrame` provides this value, and a body that renders custom rows reads it
 * through `usePanelScroll` and the `useScrollSelectedRow` hook to keep the active row visible.
 */
export interface PanelScrollValue {
  /**
   * Drawable text width of the panel in cells.
   *
   * The value excludes the two-cell border and reserves the one-cell column the vertical scrollbar
   * uses. A row that fills this width therefore never collides with the scrollbar or clips its
   * trailing marker when the panel list overflows.
   */
  readonly drawableWidth: number;
  /** Scrolls the row with the given renderable id into the visible viewport. */
  readonly scrollChildIntoView: (childId: string) => void;
}
