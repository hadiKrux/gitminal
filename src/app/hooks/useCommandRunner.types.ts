import type { CommandRequest, CommandResult } from "@/domain/commands/commands.types";

/** Failure routed to the app error surface after redaction and console formatting. */
export interface CommandFailureReport {
  /** Command that failed. */
  readonly commandId: string;
  /** Human-readable operation label. */
  readonly operationLabel: string;
  /** Decisive redacted error line. */
  readonly message: string;
  /** Redacted result, available for the overlay's detailed view and console link. */
  readonly result: CommandResult;
}

/**
 * Sink for a command failure.
 *
 * M6 replaces the default implementation with `OverlayProvider.showError`. Until then the default
 * sets an error status, which keeps the failure visible without building the overlay stack early.
 */
export type CommandErrorSink = (report: CommandFailureReport) => void;

/** Options accepted by `useCommandRunner`. */
export interface UseCommandRunnerOptions {
  /** Injected error surface. Defaults to an error status. */
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
