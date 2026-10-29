import type { CommandTargetHandle } from "@/app/hooks/useCommandTargets.types";
import type {
  CommandAvailability,
  CommandDescriptor,
  CommandFormValues,
  CommandRegion,
  CommandTarget,
} from "@/domain/commands/commands.types";

/**
 * One palette target capture request.
 *
 * The shared derivation lives in `@/app/hooks/useCommandTargets` so help and the palette read one
 * implementation. The palette adds only its own availability region rule and the availability read
 * it needs, so this contract stays narrower than the whole repository provider.
 */
export interface PaletteCommandTargetInput {
  /** Repository surface that answers the availability question. */
  readonly repository: PaletteAvailabilitySource;
  /** Shared derivation from the app layer. */
  readonly deriveTarget: CommandTargetHandle["deriveTarget"];
  /** Command whose target is captured. */
  readonly descriptor: CommandDescriptor;
}

/** The repository surface the palette consumes: target-aware availability. */
export interface PaletteAvailabilitySource {
  /**
   * Reads availability for one command and its explicit target.
   *
   * @param commandId - Command id.
   * @param target - Explicit target derived from the shared derivation.
   * @param region - Context that asked for the availability.
   * @returns Availability with a machine-readable reason when unavailable.
   */
  getAvailability(
    commandId: string,
    target: CommandTarget,
    region: CommandRegion,
    formValues?: CommandFormValues,
  ): CommandAvailability;
}

/** One captured palette target plus the availability the user sees. */
export interface PaletteCommandTargetCapture {
  /** Explicit target the palette would dispatch. */
  readonly target: CommandTarget;
  /** Availability evaluated in the palette's dispatch region. */
  readonly availability: CommandAvailability;
}
