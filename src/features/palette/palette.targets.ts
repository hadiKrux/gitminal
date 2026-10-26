import { readAvailabilityRegion } from "@/app/hooks/useCommandTargets";
import type {
  PaletteCommandTargetCapture,
  PaletteCommandTargetInput,
} from "@/features/palette/palette.targets.types";

/**
 * Captures one command's explicit target and the availability the palette shows for it.
 *
 * The target comes from the shared app-layer derivation, so a palette entry and a help row always
 * describe the same target. Availability is read from the current provider state, so a captured
 * entry reflects the repository when the palette opened and a revalidation reflects the repository
 * at activation.
 *
 * @param input - Repository, shared derivation, and the command being captured.
 * @returns The explicit target and its availability.
 */
export function captureCommandTarget(
  input: PaletteCommandTargetInput,
): PaletteCommandTargetCapture {
  const target = input.deriveTarget(input.descriptor);

  return {
    target,
    availability: input.repository.getAvailability(
      input.descriptor.id,
      target,
      readAvailabilityRegion(input.descriptor.scope),
    ),
  };
}
