import type { CommandAvailabilityReason, CommandTarget } from "@/domain/commands/commands.types";
import type { EnsureLoadedResult } from "@/domain/graph/graph.types";

/** Outcome of one internal selection command. */
export type InternalCommandResult =
  | { readonly status: "handled" }
  | { readonly status: "blocked"; readonly reason: CommandAvailabilityReason };

/** Dispatcher for the internal selection commands that have no mutation runner step. */
export interface InternalCommandsHandle {
  /**
   * Resolves one internal selection command against its explicit target.
   *
   * @param commandId - Internal command id such as `graph.selectCommit`.
   * @param target - Explicit selection target captured at dispatch time.
   * @returns Whether the selection was applied, or why it was blocked.
   */
  readonly run: (commandId: string, target: CommandTarget) => Promise<InternalCommandResult>;
  /**
   * Resolves `graph.selectCommit` and reports the detailed bounded outcome.
   *
   * @param oid - Commit OID to load and select.
   * @returns The bounded load outcome; `loaded` when the commit became the selection.
   */
  readonly selectCommit: (oid: string) => Promise<EnsureLoadedResult>;
}
