import { createElement, useCallback } from "react";
import { useCommandRunner } from "@/app/hooks/useCommandRunner";
import { useOverlay } from "@/app/hooks/useOverlay";
import { useRepository } from "@/app/hooks/useRepository";
import type { useStatus } from "@/app/hooks/useStatus";
import { describeCommandReason } from "@/domain/commands/commands.reasons";
import { CreateLocalBranchModal } from "@/features/remotes/CreateLocalBranchModal";
import {
  CREATE_LOCAL_NAME_INPUT_ID,
  CREATE_LOCAL_OVERLAY_ID_PREFIX,
} from "@/features/remotes/CreateLocalBranchModal.constants";
import type { CreateLocalBranchValues } from "@/features/remotes/CreateLocalBranchModal.types";
import type { RemoteBranchTarget } from "@/features/remotes/useRemotes.types";

/**
 * Owns the create-local-branch modal and its command dispatch.
 *
 * A null target, or a target the availability reader refuses, becomes a transient warning instead
 * of an open modal. A valid target opens the shared form, and its submit dispatches exactly
 * `remote.createLocal` through the command runner before closing.
 *
 * @param input - Repository, known local branch names, and the status writer.
 * @returns The target opener.
 */
export function useRemoteCreateLocal(input: {
  readonly existingBranchNames: readonly string[];
  readonly setStatus: ReturnType<typeof useStatus>["setStatus"];
}) {
  const repository = useRepository();
  const overlay = useOverlay();
  const { runCommand } = useCommandRunner();
  const { existingBranchNames, setStatus } = input;

  /** Dispatches one create-local-branch command with its validated form values. */
  const submitCreateLocal = useCallback(
    (target: RemoteBranchTarget, values: CreateLocalBranchValues): void => {
      void runCommand({
        commandId: "remote.createLocal",
        target: { kind: "remoteBranch", remote: target.remote, branch: target.branch },
        formValues: {
          name: values.name,
          checkout: values.checkout ? "true" : "false",
        },
      });
    },
    [runCommand],
  );

  /** Opens the create-local-branch modal for one remote branch, or reports why it cannot. */
  const openTarget = useCallback(
    (target: RemoteBranchTarget | null): void => {
      if (target === null) {
        setStatus({ kind: "info", message: describeCommandReason("missing-target") });

        return;
      }

      const availability = repository.getAvailability(
        "remote.createLocal",
        { kind: "remoteBranch", remote: target.remote, branch: target.branch },
        "remotes",
      );

      if (!availability.available) {
        setStatus({
          kind: "warning",
          message: describeCommandReason(availability.reason ?? "invalid-target"),
        });

        return;
      }

      overlay.open({
        kind: "modal",
        id: `${CREATE_LOCAL_OVERLAY_ID_PREFIX}${target.remote}/${target.branch}`,
        initialFocusId: CREATE_LOCAL_NAME_INPUT_ID,
        render: ({ close }) =>
          createElement(CreateLocalBranchModal, {
            remote: target.remote,
            branch: target.branch,
            existingBranchNames,
            onSubmit: (values: CreateLocalBranchValues) => {
              submitCreateLocal(target, values);
              close();
            },
            onCancel: close,
          }),
      });
    },
    [existingBranchNames, overlay, repository, setStatus, submitCreateLocal],
  );

  return { openTarget };
}
