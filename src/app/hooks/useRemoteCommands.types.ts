import type { RepositoryContextValue } from "@/app/providers/RepositoryProvider.types";

/** Operation family a remote command handler executes. */
export type RemoteCommandKind = "fetch" | "fetchPrune" | "pull" | "push";

/** One remote command registration. */
export interface RemoteCommandDefinition {
  /** Stable command id. */
  readonly commandId: string;
  /** User-facing operation label shown by the status strip and console. */
  readonly operationLabel: string;
  /** Executor family. */
  readonly kind: RemoteCommandKind;
}

/** Evidence writers owned by `RepositoryProvider`, captured by the hook. */
export interface RemoteEvidenceWriters {
  /** Records a successful or failed remote interaction. */
  readonly recordRemoteCheck: RepositoryContextValue["recordRemoteCheck"];
  /**
   * Records a confirmed absent upstream and re-reads the repository once.
   *
   * Reserved for the future F-04 remote-branch-deletion entry point. Prune uses
   * `recordUpstreamEvidence` instead.
   */
  readonly confirmUpstreamAbsent: RepositoryContextValue["confirmUpstreamAbsent"];
  /**
   * Records a failed upstream check and re-reads the repository once.
   *
   * Reserved for the future F-04 remote-branch-deletion entry point. Prune uses
   * `recordUpstreamEvidence` instead.
   */
  readonly markUpstreamUnknown: RepositoryContextValue["markUpstreamUnknown"];
  /** Records confirmed absent and failed upstream refs in one batch and re-reads the repository once. */
  readonly recordUpstreamEvidence: RepositoryContextValue["recordUpstreamEvidence"];
}
