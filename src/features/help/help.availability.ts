import { readAvailabilityRegion } from "@/app/hooks/useCommandTargets";
import type { CommandTargetHandle } from "@/app/hooks/useCommandTargets.types";
import { describeCommandReason } from "@/domain/commands/commands.reasons";
import { getCommandDescriptor } from "@/domain/commands/commands.registry";
import { describeHelpRows } from "@/domain/keymap/keymap.describe";
import type {
  KeymapContext,
  KeymapHelpRow,
  KeymapHelpRowOptions,
  ResolvedKeymap,
} from "@/domain/keymap/keymap.types";
import { readHelpSectionId } from "@/features/help/help.sections";
import { HELP_FALLBACK_CONTEXT } from "@/features/help/useHelp.constants";
import type { HelpAvailabilitySource, HelpRowView } from "@/features/help/useHelp.types";

/**
 * Builds the unfiltered help rows with live availability.
 *
 * @param input - Keymap, repository, shared target derivation, focus context, and right-pane mode.
 * @returns One row per implemented action, in catalogue order.
 */
export function buildHelpRows(input: {
  readonly keymap: ResolvedKeymap;
  readonly repository: HelpAvailabilitySource;
  readonly deriveTarget: CommandTargetHandle["deriveTarget"];
  readonly focusContext: KeymapContext | null;
  readonly isPendingSelection: boolean;
}): readonly HelpRowView[] {
  const contextOptions: KeymapHelpRowOptions = {
    ...(input.focusContext === null ? {} : { preferredContext: input.focusContext }),
    fallbackContext: HELP_FALLBACK_CONTEXT,
  };

  return describeHelpRows(input.keymap, contextOptions).map((row) => ({
    actionId: row.actionId,
    label: row.label,
    description: row.description,
    keys: row.keys,
    sectionId: readHelpSectionId(row, input.isPendingSelection),
    unavailableReason: readUnavailableReason(row, input),
  }));
}

/**
 * Reads the exact availability reason for one help row.
 *
 * @param row - Described action row.
 * @param input - Repository and the shared target derivation.
 * @returns The shared reason text, or null when the action can run now.
 */
function readUnavailableReason(
  row: KeymapHelpRow,
  input: {
    readonly repository: HelpAvailabilitySource;
    readonly deriveTarget: CommandTargetHandle["deriveTarget"];
  },
): string | null {
  const descriptor = getCommandDescriptor(row.actionId);

  if (descriptor === undefined) {
    return null;
  }

  const availability = input.repository.getAvailability(
    descriptor.id,
    input.deriveTarget(descriptor),
    readAvailabilityRegion(descriptor.scope),
  );

  return availability.available
    ? null
    : describeCommandReason(availability.reason ?? "command-not-implemented");
}
