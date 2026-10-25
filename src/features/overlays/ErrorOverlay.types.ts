/** Props accepted by the error overlay. */
export interface ErrorOverlayProps {
  /** Redacted failure title. */
  readonly title: string;
  /** Decisive redacted failure line. */
  readonly message: string;
  /** Redacted, capped detail block, already safe to render. */
  readonly details: string;
  /** Id of the console entry that recorded the failure, or null when no entry exists. */
  readonly consoleEntryId: string | null;
  /** True when the failed command can be retried with its captured request. */
  readonly canRetry: boolean;
  /** Dismisses the error. */
  readonly onDismiss: () => void;
  /** Opens the console at the linked entry. */
  readonly onOpenConsole: () => void;
  /** Re-runs the failed command with its captured request. */
  readonly onRetry: () => void;
}
