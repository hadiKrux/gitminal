import { type ReactNode, useCallback } from "react";
import { useAction } from "@/app/hooks/useAction";
import { useCommandRunner } from "@/app/hooks/useCommandRunner";
import { useConfig } from "@/app/hooks/useConfig";
import { useOverlay } from "@/app/hooks/useOverlay";
import type { useRepository } from "@/app/hooks/useRepository";
import type { useStatus } from "@/app/hooks/useStatus";
import type { CommandAvailability } from "@/domain/commands/commands.types";
import { CREATE_STASH_MESSAGE_FIELD_ID } from "@/features/stashes/CreateStashModal.constants";
import type { CreateStashModalProps } from "@/features/stashes/CreateStashModal.types";
import { canOpenCreateModal, readCreateBlockReason } from "@/features/stashes/stash.availability";
import { buildStashMessagePrefill } from "@/features/stashes/stash.prefill";
import {
  CREATE_STASH_OVERLAY_ID,
  STASHES_REGION_ID,
} from "@/features/stashes/useStashes.constants";
import type { PendingStashCreation } from "@/features/stashes/useStashes.types";

/**
 * Owns the Create Stash command, modal, and pending-selection request.
 *
 * The panel opens the form even when the working tree would block the command, because the Include
 * untracked files checkbox is the remedy. A successful create records the message, the snapshot it
 * started from, and the pre-command row count, so the panel can select the created stash only when
 * the refreshed list proves it grew.
 *
 * @param input - Availability, busy state, snapshot, row count, pending writer, and modal renderer.
 * @returns The `stash.create` opener.
 */
export function useStashCreateCommand(input: {
  readonly availability: CommandAvailability;
  readonly busy: boolean;
  readonly orderedRowCount: number;
  readonly renderCreateStashModal: (input: CreateStashModalProps) => ReactNode;
  readonly repository: ReturnType<typeof useRepository>;
  readonly setPendingCreatedStash: (pending: PendingStashCreation) => void;
  readonly setStatus: ReturnType<typeof useStatus>["setStatus"];
}) {
  const overlay = useOverlay();
  const config = useConfig();
  const { runCommand } = useCommandRunner();
  const {
    availability,
    busy,
    orderedRowCount,
    renderCreateStashModal,
    repository,
    setPendingCreatedStash,
    setStatus,
  } = input;

  /** Opens the Create Stash modal, including when only the checkbox can make it runnable. */
  const openCreate = useCallback((): void => {
    if (busy || !canOpenCreateModal(availability)) {
      setStatus({ kind: "warning", message: readCreateBlockReason(busy, availability) });
      return;
    }

    const initialMessage = buildStashMessagePrefill(repository.snapshot);
    const includeUntrackedByDefault = config.config.stash.includeUntrackedByDefault;

    overlay.open({
      kind: "modal",
      id: CREATE_STASH_OVERLAY_ID,
      initialFocusId: CREATE_STASH_MESSAGE_FIELD_ID,
      render: ({ close }) =>
        renderCreateStashModal({
          messageFieldId: CREATE_STASH_MESSAGE_FIELD_ID,
          initialMessage,
          includeUntrackedByDefault,
          onClose: close,
          onCreate: ({ message, includeUntracked }) => {
            const snapshot = repository.snapshot;

            void runCommand({
              commandId: "stash.create",
              target: { kind: "none" },
              formValues: {
                message,
                includeUntracked: includeUntracked ? "true" : "false",
              },
            })
              .then((result) => {
                if (result.status === "success") {
                  setPendingCreatedStash({
                    message,
                    snapshot,
                    previousCount: orderedRowCount,
                  });
                }
              })
              .catch(() => undefined);
          },
        }),
    });
  }, [
    availability,
    busy,
    config,
    orderedRowCount,
    overlay,
    renderCreateStashModal,
    repository,
    runCommand,
    setPendingCreatedStash,
    setStatus,
  ]);

  useAction("stash.create", { scope: STASHES_REGION_ID, targetKind: "none" }, openCreate);
}
