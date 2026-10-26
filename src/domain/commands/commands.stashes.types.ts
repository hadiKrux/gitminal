import type {
  CommandAvailabilityReason,
  CommandStepResult,
} from "@/domain/commands/commands.types";

/** Stash subcommand an action executes. */
export type StashAction = "apply" | "pop" | "drop";

/** Result of resolving an immutable stash object name to a current selector. */
export type StashResolution =
  | { readonly ok: true; readonly step: CommandStepResult; readonly index: string }
  | {
      readonly ok: false;
      readonly failed: boolean;
      readonly step: CommandStepResult;
      readonly reason: CommandAvailabilityReason;
    };
