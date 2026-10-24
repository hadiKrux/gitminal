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

  /**
   * Records a confirmed absent upstream and re-reads the repository.
   *
   * Reserved for the future F-04 remote-branch-deletion entry point; the prune path must keep using
   * `recordUpstreamEvidence`, which folds its whole result into one batched write and one refresh.
   * This single-ref writer refreshes once per call, so reintroducing it into a multi-ref prune would
   * restore the per-ref refresh the batch writer exists to prevent.
   */
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

  /**
   * Records a failed upstream check and re-reads the repository.
   *
   * Reserved for the future F-04 remote-branch-deletion entry point; the prune path must keep using
   * `recordUpstreamEvidence`. This single-ref writer refreshes once per call, so reintroducing it
   * into a multi-ref prune would restore the per-ref refresh the batch writer prevents.
   */
  const markUpstreamUnknown = useCallback(
    async (ref: string): Promise<RepositoryRefreshResult> => {
      evidenceRef.current = withUnknownCheck(evidenceRef.current, ref);

      return await refreshRef.current();
    },
    [evidenceRef],
  );

  /** Records confirmed absent refs and failed checks in one batched evidence write and refresh. */
  const recordUpstreamEvidence = useCallback(
    async (
      prunedRefs: readonly string[],
      unknownRefs: readonly string[],
    ): Promise<RepositoryRefreshResult | null> => {
      if (prunedRefs.length === 0 && unknownRefs.length === 0) {
        return null;
      }

      for (const ref of prunedRefs) {
        evidenceRef.current = withPruneConfirmation(evidenceRef.current, ref);
      }

      for (const ref of unknownRefs) {
        evidenceRef.current = withUnknownCheck(evidenceRef.current, ref);
      }

      return await refreshRef.current();
    },
    [evidenceRef],
  );

  return {
    recordRemoteCheck,
    confirmUpstreamAbsent,
    markUpstreamUnknown,
    recordUpstreamEvidence,
  };
}
