import { listCommandDescriptors } from "@/domain/commands/commands.registry";
import type { CommandDescriptor } from "@/domain/commands/commands.types";
import { formatBinding } from "@/domain/keymap/keymap.describe";
import type { ResolvedKeymap } from "@/domain/keymap/keymap.types";
import { PALETTE_UNBOUND_LABEL } from "@/features/palette/CommandRow.constants";
import type { PaletteCommandEntry } from "@/features/palette/CommandRow.types";
import type { PaletteEntryCaptureInput } from "@/features/palette/palette.capture.types";
import { captureCommandTarget } from "@/features/palette/palette.targets";

/**
 * Captures every palette-invocable command with its target, availability, and shortcuts.
 *
 * The capture happens once when the palette opens, in catalogue order. Each entry is the snapshot
 * the user sees: the explicit target derived from the provider projections, the availability read
 * for that target, and the effective bindings. Activation re-derives the target and availability
 * instead of trusting the entry, so nothing here needs to stay live.
 *
 * @param input - Repository, keymap, and the shared target derivation.
 * @returns The capture in catalogue order, read-only by contract.
 */
export function capturePaletteEntries(
  input: PaletteEntryCaptureInput,
): readonly PaletteCommandEntry[] {
  return listCommandDescriptors()
    .filter((descriptor) => descriptor.paletteInvocable)
    .flatMap((descriptor) => {
      if (descriptor.id === "remote.fetch" && input.remotes !== undefined) {
        return input.remotes.map((remote) => ({
          descriptor: {
            ...descriptor,
            id: `remote.fetch:${remote}`,
            label: `Fetch ${remote}`,
            description: `Fetch configured branches from ${remote} without pruning`,
            keywords: [...descriptor.keywords, remote],
          },
          fetchRemote: remote,
          target: { kind: "none" } as const,
          availability: input.repository.getAvailability(
            "remote.fetch",
            { kind: "none" },
            "overlay",
            { remote },
          ),
          shortcuts: [],
          shortcut: PALETTE_UNBOUND_LABEL,
        }));
      }

      const { target, availability } = captureCommandTarget({
        repository: input.repository,
        deriveTarget: input.deriveTarget,
        descriptor,
      });
      const shortcuts = readShortcuts(input.keymap, descriptor);

      return [
        {
          descriptor,
          target,
          availability,
          shortcuts,
          shortcut: shortcuts[0] ?? PALETTE_UNBOUND_LABEL,
        },
      ];
    });
}

/**
 * Reads a command's effective bindings in display form.
 *
 * The descriptor's action id is the binding key, falling back to the command id for the commands
 * that reuse it, so the palette and the footer always show the same chord.
 *
 * @param keymap - Resolved keymap.
 * @param descriptor - Command descriptor.
 * @returns The formatted shortcuts, empty when the action is unbound.
 */
function readShortcuts(keymap: ResolvedKeymap, descriptor: CommandDescriptor): readonly string[] {
  const actionId = descriptor.actionId ?? descriptor.id;
  const bindings = keymap.bindings.get(actionId) ?? [];

  return bindings.map(formatBinding);
}
