import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
  RepositoryRefreshResult,
  RepositoryStore,
} from "@/app/providers/RepositoryProvider.types";
import type { RemoteCheckKind, UpstreamEvidence } from "@/domain/repository/repository.types";

/** Inputs accepted by `useRepositoryEvidence`. */
export interface RepositoryEvidenceHookInput {
  /** Full refresh entry point owned by the refresh cycle. */
  readonly refresh: () => Promise<RepositoryRefreshResult>;
  /** Store writer for remote check timestamps. */
  readonly setStore: Dispatch<SetStateAction<RepositoryStore>>;
  /** Clock used for success timestamps. */
  readonly now: () => number;
  /** Shared upstream deletion and failure evidence. */
  readonly evidenceRef: MutableRefObject<UpstreamEvidence>;
}

/** Evidence operations exposed by `useRepositoryEvidence`. */
export interface RepositoryEvidenceHook {
  /**
   * Records a successful remote interaction; a failure leaves the timestamp untouched.
   *
   * @param remote - Remote name.
   * @param kind - Check or fetch.
   * @param succeeded - False records a failed attempt without moving the timestamp.
   */
  recordRemoteCheck(remote: string, kind: RemoteCheckKind, succeeded: boolean): void;
  /**
   * Records a confirmed absent upstream ref and re-reads the repository.
   *
   * @param ref - Upstream ref confirmed absent.
   * @param basis - Successful prune or successful app-initiated remote deletion.
   * @returns The refresh result.
   */
  confirmUpstreamAbsent(
    ref: string,
    basis: "prune" | "app-deletion",
  ): Promise<RepositoryRefreshResult>;
  /**
   * Records a failed or timed-out upstream check and re-reads the repository.
   *
   * @param ref - Upstream ref whose check failed.
   * @returns The refresh result.
   */
  markUpstreamUnknown(ref: string): Promise<RepositoryRefreshResult>;
}
