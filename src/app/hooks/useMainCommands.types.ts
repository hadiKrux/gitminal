import type {
  CommandExecutionOutcome,
  CommandHandlerContext,
} from "@/domain/commands/commands.types";

/** One command the main-area feature surfaces register with the shared runner. */
export interface MainCommandDefinition {
  /** Stable command id. */
  readonly commandId: string;
  /** Executor for the command. */
  readonly execute: (context: CommandHandlerContext) => Promise<CommandExecutionOutcome>;
}
