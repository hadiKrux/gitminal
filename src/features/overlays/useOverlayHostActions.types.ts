/** Actions the overlay host projects from the overlay, console, and focus providers. */
export interface OverlayHostActions {
  /**
   * Dismisses the error, opens the console at the linked entry, and focuses the console region.
   *
   * @param consoleEntryId - Console entry to reveal, or null when the failure has no entry.
   */
  openConsoleEntry(consoleEntryId: string | null): void;
  /**
   * Dismisses the error and re-runs the failed command.
   *
   * @param retry - Captured retry closure, or undefined when retry is not meaningful.
   */
  retryError(retry: (() => void) | undefined): void;
}
