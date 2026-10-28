import type { GitInvocationResult } from "@/domain/git/git.types";
import type { UpstreamDescriptor } from "@/domain/repository/repository.types";
import type { CommandRemoteResult, CommandStepResult } from "./commands.types";

/** Result of confirming the heads one remote advertises before a prune. */
export interface RemoteHeadsCheck {
  /** True only for a clean exit whose output parsed. */
  readonly ok: boolean;
  /** Advertised branch names, empty when the check failed. */
  readonly heads: readonly string[];
  /** Raw invocation result, kept so the caller can record the step. */
  readonly result: GitInvocationResult;
}

/** Result of fetching every still-advertised ref of one remote. */
export interface RemotePruneFetchRun {
  /** Ordered invocations made for this group. */
  readonly steps: readonly CommandStepResult[];
  /** Refs fetched successfully. */
  readonly fetchedRefs: readonly UpstreamDescriptor[];
  /** Refs whose presence could not be confirmed by a successful fetch. */
  readonly unknownRefs: readonly UpstreamDescriptor[];
  /** True when an invocation was cancelled. */
  readonly cancelled: boolean;
  /** True when an invocation timed out. */
  readonly timedOut: boolean;
}

/** Result of one remote-wide prune or one per-ref delete invocation. */
export interface RemotePruneStepRun {
  /** The single invocation made for the phase. */
  readonly step: CommandStepResult;
  /** True when the invocation exited cleanly. */
  readonly ok: boolean;
  /** True when the invocation was cancelled. */
  readonly cancelled: boolean;
  /** True when the invocation timed out. */
  readonly timedOut: boolean;
}

/** Result of deleting every confirmed-stale ref of one remote. */
export interface RemotePruneDeleteRun {
  /** Ordered invocations made for this group. */
  readonly steps: readonly CommandStepResult[];
  /** Refs deleted locally. */
  readonly prunedRefs: readonly UpstreamDescriptor[];
  /** Refs whose deletion failed or never ran. */
  readonly unknownRefs: readonly UpstreamDescriptor[];
  /** True when an invocation was cancelled. */
  readonly cancelled: boolean;
  /** True when an invocation timed out. */
  readonly timedOut: boolean;
}

/** Settled remote-wide prune and per-ref delete phases of one group. */
export interface RemotePruneCleanupRun {
  /** Settled remote-wide prune, or null when the effective scope skipped it. */
  readonly pruneRun: RemotePruneStepRun | null;
  /** Settled per-ref delete phase, empty when a cancelled prune skipped it. */
  readonly deleteRun: RemotePruneDeleteRun;
}

/** Result of one remote group during Fetch --prune. */
export interface RemotePruneGroupRun {
  /** Ordered invocations made for this group. */
  readonly steps: readonly CommandStepResult[];
  /**
   * Whether the check, the fetch, and the per-ref deletes of this group succeeded.
   *
   * The remote-wide prune phase is deliberately excluded: the check and the scoped fetch already
   * succeeded, so a failed or timed-out cleanup is reported as a warning instead of regressing this
   * remote's freshness evidence.
   */
  readonly remoteResult: CommandRemoteResult;
  /** Upstream refs this group confirmed absent and deleted locally. */
  readonly prunedRefs: readonly UpstreamDescriptor[];
  /** Refs this group could not confirm or delete. */
  readonly unknownRefs: readonly UpstreamDescriptor[];
  /** Per-remote warnings. */
  readonly warnings: readonly string[];
  /** Refs fetched successfully. */
  readonly fetchedCount: number;
  /** Refs confirmed absent by the remote check, whether or not deletion succeeded. */
  readonly missingCount: number;
  /**
   * True when an invocation for this group was cancelled, including a cancelled remote-wide prune.
   *
   * A cancelled prune skips the explicit per-ref deletes, so every planned ref stays unknown.
   */
  readonly cancelled: boolean;
  /**
   * True when the check, the fetch, or an explicit per-ref delete timed out.
   *
   * The remote-wide prune is deliberately excluded, because the fetch already succeeded and a timed
   * out prune is reported as a warning on the step instead.
   */
  readonly timedOut: boolean;
}

/** Accumulated result of every remote group. */
export interface RemotePruneRun {
  /** Ordered invocations across every group. */
  readonly steps: readonly CommandStepResult[];
  /** Per-remote results. */
  readonly remoteResults: readonly CommandRemoteResult[];
  /** Refs confirmed absent and deleted locally. */
  readonly prunedRefs: readonly UpstreamDescriptor[];
  /** Refs whose presence or deletion could not be confirmed. */
  readonly unknownRefs: readonly UpstreamDescriptor[];
  /** Per-remote and summary warnings. */
  readonly warnings: readonly string[];
  /** Refs fetched successfully across every group. */
  readonly fetchedCount: number;
  /** Refs confirmed absent across every group. */
  readonly missingCount: number;
  /** Groups with at least one failed phase outside the prune phase. */
  readonly failedRemoteCount: number;
}

/**
 * Mutable accumulator while groups settle.
 *
 * Arrays stay mutable so one group merge appends in place, and the counters stay writable so the
 * accumulator is updated without rebuilding it per group. `buildPruneOutcome` accepts it as the
 * readonly `RemotePruneRun` view.
 */
export interface RemotePruneAccumulator {
  /** Ordered invocations across every settled group. */
  readonly steps: CommandStepResult[];
  /** Per-remote results of every settled group. */
  readonly remoteResults: CommandRemoteResult[];
  /** Refs confirmed absent and deleted locally. */
  readonly prunedRefs: UpstreamDescriptor[];
  /** Refs whose presence or deletion could not be confirmed. */
  readonly unknownRefs: UpstreamDescriptor[];
  /** Per-remote and summary warnings. */
  readonly warnings: string[];
  /** Refs fetched successfully across every settled group. */
  fetchedCount: number;
  /** Refs confirmed absent across every settled group. */
  missingCount: number;
  /** Groups with at least one failed phase outside the prune phase. */
  failedRemoteCount: number;
}
