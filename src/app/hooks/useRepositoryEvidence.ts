import { useCallback, useRef } from "react";
import type {
  RepositoryEvidenceHook,
  RepositoryEvidenceHookInput,
} from "@/app/hooks/useRepositoryEvidence.types";
import { updateRemoteCheck } from "@/app/providers/RepositoryProvider.store";
import type { RepositoryRefreshResult } from "@/app/providers/RepositoryProvider.types";
import type { RemoteCheckKind } from "@/domain/repository/repository.types";
import {
  withAppDeletion,
  withPruneConfirmation,
  withUnknownCheck,
} from "@/domain/repository/repository.upstream";

/**
 * Owns upstream deletion evidence and per-remote success timestamps.
 *
 * Evidence is the only input that may turn a missing upstream into `deleted-after-prune` or
 * `deleted-after-app-deletion`. It is written only by a successful prune or a successful
 * app-initiated remote deletion, and a failed check records `unknown` instead. Remote timestamps
 * move only on success, so a failed check can never look fresh.
 *
 * @param input - Refresh entry point, store writer, and clock.
 * @returns The evidence operations.
 */
export function useRepositoryEvidence(input: RepositoryEvidenceHookInput): RepositoryEvidenceHook {
  const { evidenceRef, now, refresh, setStore } = input;
  const refreshRef = useRef(refresh);

  refreshRef.current = refresh;

  /** Records a successful remote interaction. */
  const recordRemoteCheck = useCallback(
    (remote: string, kind: RemoteCheckKind, succeeded: boolean): void => {
      if (!succeeded) {
        return;
      }

      setStore((previous) => ({
        ...previous,
        remoteChecks: {
          ...previous.remoteChecks,
          [remote]: updateRemoteCheck(previous.remoteChecks[remote], kind, now()),
        },
      }));
    },
    [now, setStore],
  );

  /** Records a confirmed absent upstream and re-reads the repository. */
  const confirmUpstreamAbsent = useCallback(
    async (ref: string, basis: "prune" | "app-deletion"): Promise<RepositoryRefreshResult> => {
      evidenceRef.current =
        basis === "prune"
          ? withPruneConfirmation(evidenceRef.current, ref)
          : withAppDeletion(evidenceRef.current, ref);

      return await refreshRef.current();
    },
    [evidenceRef],
  );

  /** Records a failed upstream check and re-reads the repository. */
  const markUpstreamUnknown = useCallback(
    async (ref: string): Promise<RepositoryRefreshResult> => {
      evidenceRef.current = withUnknownCheck(evidenceRef.current, ref);

      return await refreshRef.current();
    },
    [evidenceRef],
  );

  return { recordRemoteCheck, confirmUpstreamAbsent, markUpstreamUnknown };
}
