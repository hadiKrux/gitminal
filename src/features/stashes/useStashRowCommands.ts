import { type ReactNode, useCallback } from "react";
import { useAction } from "@/app/hooks/useAction";
import { useCommandRunner } from "@/app/hooks/useCommandRunner";
import { useOverlay } from "@/app/hooks/useOverlay";
import type { useRepository } from "@/app/hooks/useRepository";
import type { useStatus } from "@/app/hooks/useStatus";
import { describeCommandReason } from "@/domain/commands/commands.reasons";
import { CONFIRM_LABELS } from "@/domain/commands/confirm.labels";
import type { StashRecord } from "@/domain/git/git.types";
import {
  buildPopDescription,
  readAvailabilityReason,
  readStashActionAvailability,
} from "@/features/stashes/stash.availability";
import {
  DELETE_STASH_OVERLAY_ID_PREFIX,
  POP_STASH_TITLE,
  STASHES_REGION_ID,
} from "@/features/stashes/useStashes.constants";
import type { DeleteStashModalInput } from "@/features/stashes/useStashes.types";
import { useStashMutations } from "@/features/stashes/useStashMutations";

/**
 * Owns the apply, pop, and delete commands for the selected stash.
 *
 * Apply runs immediately. Pop and delete open their confirmation only after a fresh availability
 * check, so a vanished or externally changed stash is reported instead of opening a dead form.
 * Every mutation resolves the immutable object name at action time.
 *
 * @param input - Selection, list size, busy state, collaborators, and the delete modal renderer.
 */
export function useStashRowCommands(input: {
  readonly busy: boolean;
  readonly renderDeleteStashModal: (input: DeleteStashModalInput) => ReactNode;
  readonly repository: ReturnType<typeof useRepository>;
  readonly selected: StashRecord | null;
  readonly setStatus: ReturnType<typeof useStatus>["setStatus"];
  readonly totalCount: number;
}): void {
  const overlay = useOverlay();
  const { runCommand } = useCommandRunner();
  const { busy, renderDeleteStashModal, repository, selected } = input;
  const { setStatus, totalCount } = input;
  const runStashAction = useStashMutations({
    refreshStatus: repository.refreshStatus,
    runCommand,
    setStatus,
  });

  /** Shows a display reason as a transient warning status. */
  const reportReason = useCallback(
    (reason: string): void => {
      setStatus({ kind: "warning", message: reason });
    },
    [setStatus],
  );

  /** Applies the selected stash immediately, keeping it. */
  const applySelected = useCallback((): void => {
    if (selected === null) {
      reportReason(describeCommandReason("no-stash-selected"));
      return;
    }

    if (busy) {
      reportReason(describeCommandReason("operation-in-progress"));
      return;
    }

    void runStashAction("stash.apply", selected.objectName);
  }, [busy, reportReason, runStashAction, selected]);

  /** Opens the Pop stash confirmation for the selected stash. */
  const openPop = useCallback((): void => {
    if (selected === null) {
      reportReason(describeCommandReason("no-stash-selected"));
      return;
    }

    if (busy) {
      reportReason(describeCommandReason("operation-in-progress"));
      return;
    }

    const reason = readAvailabilityReason(
      readStashActionAvailability(repository, "stash.pop", selected, totalCount),
    );

    if (reason !== null) {
      reportReason(reason);
      return;
    }

    const objectName = selected.objectName;

    overlay.confirm({
      title: POP_STASH_TITLE,
      description: buildPopDescription(selected),
      confirmLabel: CONFIRM_LABELS.dropStash,
      destructive: true,
      onConfirm: () => {
        void runStashAction("stash.pop", objectName);
      },
    });
  }, [busy, overlay, reportReason, repository, runStashAction, selected, totalCount]);

  /** Opens the Delete Stash confirmation for the selected stash. */
  const openDelete = useCallback((): void => {
    if (selected === null) {
      reportReason(describeCommandReason("no-stash-selected"));
      return;
    }

    if (busy) {
      reportReason(describeCommandReason("operation-in-progress"));
      return;
    }

    const reason = readAvailabilityReason(
      readStashActionAvailability(repository, "stash.delete", selected, totalCount),
    );

    if (reason !== null) {
      reportReason(reason);
      return;
    }

    const stash = selected;

    overlay.open({
      kind: "modal",
      id: `${DELETE_STASH_OVERLAY_ID_PREFIX}${stash.objectName}`,
      render: ({ close }) =>
        renderDeleteStashModal({
          stash,
          onClose: close,
          onDrop: (objectName) => {
            void runStashAction("stash.delete", objectName);
          },
        }),
    });
  }, [
    busy,
    overlay,
    renderDeleteStashModal,
    reportReason,
    repository,
    runStashAction,
    selected,
    totalCount,
  ]);

  useAction("stash.apply", { scope: STASHES_REGION_ID, targetKind: "stash" }, applySelected);
  useAction("stash.pop", { scope: STASHES_REGION_ID, targetKind: "stash" }, openPop);
  useAction("stash.delete", { scope: STASHES_REGION_ID, targetKind: "stash" }, openDelete);
}
