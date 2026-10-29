import { useCallback } from "react";
import { resolveActionHandler } from "@/app/hooks/useAction";
import { useCommandRunner } from "@/app/hooks/useCommandRunner";
import { useFocusState } from "@/app/hooks/useFocusState";
import { useStatus } from "@/app/hooks/useStatus";
import { describeCommandReason } from "@/domain/commands/commands.reasons";
import type { CommandDescriptor } from "@/domain/commands/commands.types";
import { PALETTE_SELF_COMMAND_IDS } from "@/features/palette/CommandPalette.constants";
import { decodePaletteValue } from "@/features/palette/CommandRow";
import type { PaletteCommandEntry, PaletteRow } from "@/features/palette/CommandRow.types";
import { recordRecentCommand } from "@/features/palette/palette.search";
import { captureCommandTarget } from "@/features/palette/palette.targets";
import {
  PALETTE_HIDDEN_SURFACE_MESSAGE,
  PALETTE_STALE_TARGET_REASON,
} from "@/features/palette/palette.targets.constants";
import type { UseCommandPaletteOptions } from "@/features/palette/useCommandPalette.types";
import type { PaletteCapture } from "@/features/palette/usePaletteCapture";
import type { PaletteDispatch } from "./usePaletteDispatch.types";

/**
 * Owns the palette's target-explicit activation path.
 *
 * Activation is target-explicit and safe, with one deliberate exception: the entries are a snapshot
 * captured at open, so a captured-disabled entry stays inert until the palette is reopened (F-12),
 * while only a captured-available entry is revalidated with fresh state on Enter. A revalidated
 * command whose fresh availability is false, whose fresh target differs from the captured target,
 * or whose owning handler is not registered closes the palette, requests focus on the owning region,
 * and reports the reason through `StatusProvider`. Only a command that survives all three checks
 * closes the palette and dispatches to exactly one owning-scope handler; the handler receives no
 * target and re-derives the same target from the live projection, which is why the captured target
 * is validated for equality first. Remote-specific Fetch entries are the explicit-argument exception:
 * they revalidate the captured remote and send it directly to the existing command orchestrator,
 * rather than dispatching the global shortcut handler whose remote is always origin.
 *
 * Dispatch is causal, not timed. The palette closes through `options.onClose(completion)` and the
 * overlay provider runs that completion once the captured background focus is restored, so a
 * focus-only command is never undone by the restore and a refused command still moves focus after
 * the palette is gone. When another surface is open at the point the completion would run, the
 * overlay discards it: the command does not run, nothing is recorded as recent, and the status strip
 * and console stay unchanged. A background refresh that lands between validation and the
 * post-restore completion is the residual risk: the handler re-reads the live projection, so it may
 * name a row the validation did not see.
 *
 * @param capture - Captured entries and the projections the revalidation reads.
 * @param options - Overlay close callback that accepts a post-restore completion.
 * @returns The activation handlers.
 */
export function usePaletteDispatch(
  capture: PaletteCapture,
  options: UseCommandPaletteOptions,
): PaletteDispatch {
  const focus = useFocusState();
  const { runCommand } = useCommandRunner();
  const { setStatus } = useStatus();
  const { entries, repository, targets } = capture;

  /**
   * Refuses one command: closes the palette, requests focus on the owning region, and reports why.
   *
   * The focus move is a post-restore completion, so it runs after the overlay has restored the
   * background focus instead of racing that restore. A global or overlay command has no owning
   * region, so the completion leaves focus unchanged and the status strip is the only effect.
   */
  const refuse = useCallback(
    (descriptor: CommandDescriptor, message: string): void => {
      const owner = targets.readOwningRegion(descriptor.scope);

      options.onClose(() => {
        if (owner !== null) {
          focus.focusRegion(owner);
        }
      });
      setStatus({ kind: "warning", message });
    },
    [focus, options, setStatus, targets],
  );

  /**
   * Revalidates one captured command and dispatches it after the overlay restores focus.
   *
   * The self-toggle row closes without a completion and without a dispatch: running its global
   * handler after the overlay closed would reopen the palette it was asked to dismiss. The command
   * is recorded as recent inside the completion, so a dispatch the overlay discards is not recorded
   * as a command that ran.
   */
  const activateEntry = useCallback(
    (entry: PaletteCommandEntry): void => {
      if (!entry.availability.available) {
        return;
      }

      const descriptor = entry.descriptor;

      if (entry.fetchRemote !== undefined) {
        dispatchRemoteFetch({
          remote: entry.fetchRemote,
          descriptor,
          repository,
          onClose: options.onClose,
          runCommand,
          refuse,
        });
        return;
      }

      if (PALETTE_SELF_COMMAND_IDS.has(descriptor.id)) {
        options.onClose();

        return;
      }

      const fresh = captureCommandTarget({
        repository,
        deriveTarget: targets.deriveTarget,
        descriptor,
      });

      if (!fresh.availability.available) {
        refuse(
          descriptor,
          describeCommandReason(fresh.availability.reason ?? "command-not-implemented"),
        );

        return;
      }

      if (!targets.areCommandTargetsEqual(fresh.target, entry.target)) {
        refuse(descriptor, describeCommandReason(PALETTE_STALE_TARGET_REASON));

        return;
      }

      const actionId = descriptor.actionId;
      const handler =
        actionId === undefined ? undefined : resolveActionHandler(actionId, descriptor.scope);

      if (handler === undefined) {
        refuse(descriptor, PALETTE_HIDDEN_SURFACE_MESSAGE);

        return;
      }

      options.onClose(() => {
        recordRecentCommand(descriptor.id);
        handler();
      });
    },
    [options, refuse, repository, targets, runCommand],
  );

  /** Runs the highlighted command after revalidation. */
  const activate = useCallback(
    (rows: readonly PaletteRow[], selectableIndex: number): void => {
      const row = rows[selectableIndex];

      if (row === undefined || row.value.kind !== "command") {
        return;
      }

      const commandId = row.value.commandId;
      const entry = entries.find((candidate) => candidate.descriptor.id === commandId);

      if (entry !== undefined) {
        activateEntry(entry);
      }
    },
    [activateEntry, entries],
  );

  /** Activates the option value reported by the native select. */
  const selectValue = useCallback(
    (value: string): void => {
      const decoded = decodePaletteValue(value);

      if (decoded?.kind !== "command") {
        return;
      }

      const entry = entries.find((candidate) => candidate.descriptor.id === decoded.commandId);

      if (entry !== undefined) {
        activateEntry(entry);
      }
    },
    [activateEntry, entries],
  );

  return { activate, selectValue };
}

/**
 * Revalidates one explicit remote and dispatches Fetch only after the palette restores focus.
 * @param input - Captured remote, live availability, refusal writer, close boundary, and orchestrator.
 */
function dispatchRemoteFetch(input: {
  readonly remote: string;
  readonly descriptor: CommandDescriptor;
  readonly repository: PaletteCapture["repository"];
  readonly onClose: UseCommandPaletteOptions["onClose"];
  readonly runCommand: ReturnType<typeof useCommandRunner>["runCommand"];
  readonly refuse: (descriptor: CommandDescriptor, message: string) => void;
}): void {
  const { remote, descriptor, repository, onClose, runCommand, refuse } = input;
  const availability = repository.getAvailability("remote.fetch", { kind: "none" }, "overlay", {
    remote,
  });

  if (!availability.available) {
    refuse(descriptor, describeCommandReason(availability.reason ?? "unknown-remote"));
    return;
  }

  onClose(() => {
    recordRecentCommand(descriptor.id);
    void runCommand({
      commandId: "remote.fetch",
      target: { kind: "none" },
      formValues: { remote },
    }).catch(() => {
      // The orchestrator already surfaced the failure; consume its rejected completion.
    });
  });
}

export type { PaletteDispatch } from "./usePaletteDispatch.types";
