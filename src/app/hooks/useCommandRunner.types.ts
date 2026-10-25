import type { CommandRequest, CommandResult } from "@/domain/commands/commands.types";

/** Failure routed to the app error surface after redaction and console formatting. */
export interface CommandFailureReport {
  /** Command that failed. */
  readonly commandId: string;
  /** Human-readable operation label. */
  readonly operationLabel: string;
  /** Decisive redacted error line. */
  readonly message: string;
  /** Redacted, capped detail block for the error overlay. */
  readonly details: string;
  /** Console entry that recorded the failure, or null when it could not be recorded. */
  readonly consoleEntryId: string | null;
  /** Re-runs the failed command with its captured request, when retry is meaningful. */
  readonly retry?: () => void;
}

/**
 * Sink for a command failure.
 *
 * The default implementation is `OverlayProvider.showError`, so a failure opens the persistent error
 * overlay instead of a temporary error status. A caller may inject its own sink for a test or a
 * specialized surface.
 */
export type CommandErrorSink = (report: CommandFailureReport) => void;

/** Options accepted by `useCommandRunner`. */
export interface UseCommandRunnerOptions {
  /** Injected error surface. Defaults to the persistent error overlay. */
  readonly onError?: CommandErrorSink;
}

/** Value returned by `useCommandRunner`. */
export interface CommandRunnerHook {
  /**
   * Runs one command through the domain runner and applies every result effect.
   *
   * @param request - Command id, explicit target, and optional form values.
   * @returns The redacted command result.
   */
  runCommand(request: CommandRequest): Promise<CommandResult>;
  /** Aborts the in-flight command and resolves after it has settled. */
  abort(): Promise<void>;
}

/** Status and error writers used when a command settles. */
export interface CommandStatusWriters {
  /** Transient status writer. */
  readonly setStatus: (status: {
    kind: "success" | "warning" | "error" | "info";
    message: string;
  }) => void;
  /** Error surface. */
  readonly errorSink: CommandErrorSink;
}
