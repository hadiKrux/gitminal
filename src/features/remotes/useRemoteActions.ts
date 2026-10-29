import { useCallback, useEffect } from "react";
import { useAction } from "@/app/hooks/useAction";
import { publishActionAvailability } from "@/app/hooks/useActionAvailability";
import type { useRepository } from "@/app/hooks/useRepository";
import type { RemoteBranchTarget } from "@/features/remotes/useRemotes.types";

/**
 * Owns the Remotes region action registrations and target-aware availability.
 *
 * `remote.createLocal` forwards the current selection to the create-local opener, which refuses a
 * missing target with the shared status text. Its footer availability is published from the same
 * selector, so a missing selection hides the action. Search is owned separately by `useFeatureSearch`.
 * The hook also builds the panel Retry handler and the read-only probe.
 *
 * @param input - Selected branch, target opener, and repository context.
 * @returns The Retry handler and the operation-in-progress flag.
 */
export function useRemoteActions(input: {
  readonly selectedBranch: RemoteBranchTarget | null;
  readonly openTarget: (target: RemoteBranchTarget | null) => void;
  readonly repository: ReturnType<typeof useRepository>;
}) {
  const { openTarget, repository, selectedBranch } = input;
  const selectedAvailability =
    selectedBranch === null
      ? null
      : repository.getAvailability(
          "remote.createLocal",
          { kind: "remoteBranch", remote: selectedBranch.remote, branch: selectedBranch.branch },
          "remotes",
        );
  const selectedAvailable = selectedAvailability?.available === true;
  const idleProbe = repository.getAvailability("remote.createLocal", { kind: "none" }, "remotes");

  useAction("remote.createLocal", { scope: "remotes", targetKind: "remoteBranch" }, () => {
    openTarget(selectedBranch);
  });

  useEffect(
    () => publishActionAvailability("remotes", "remote.createLocal", selectedAvailable),
    [selectedAvailable],
  );

  /** Retries the remote-branch read through the repository refresh cycle. */
  const retry = useCallback((): void => {
    void repository.refreshStatus();
  }, [repository]);

  return {
    retry,
    operationInProgress: !idleProbe.available && idleProbe.reason === "operation-in-progress",
  };
}
