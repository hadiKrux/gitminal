import type {
  CommandExecutionOutcome,
  CommandHandlerContext,
} from "@/domain/commands/commands.types";

/**
 * App-layer evidence a registered panel command applies after its executor settles.
 *
 * `branchDelete` records a confirmed remote deletion when the remote half succeeded, and `remoteTags`
 * re-reads the remote tag sets a push or delete reached. Every other command needs no evidence.
 */
export type PanelEvidenceKind = "none" | "branchDelete" | "remoteTags";

/** One panel command registration: its catalogue id, executor, and post-execution evidence. */
export interface PanelCommandDefinition {
  /** Stable command id from the command catalogue. */
  readonly commandId: string;
  /** Domain executor that performs the mutation. */
  readonly execute: (context: CommandHandlerContext) => Promise<CommandExecutionOutcome>;
  /** Evidence the app layer records after the executor settles. */
  readonly evidence: PanelEvidenceKind;
}
