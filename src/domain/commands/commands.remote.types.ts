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

/** Result of deleting every confirmed-stale ref of one remote. */
export interface RemotePruneDeleteRun {
  /** Ordered invocations made for this group. */
  readonly steps: readonly CommandStepResult[];
  /** Refs deleted locally. */
  readonly prunedRefs: readonly UpstreamDescriptor[];
  /** Refs whose deletion failed. */
  readonly unknownRefs: readonly UpstreamDescriptor[];
  /** True when an invocation was cancelled. */
  readonly cancelled: boolean;
  /** True when an invocation timed out. */
  readonly timedOut: boolean;
}

/** Result of one remote group during Fetch --prune. */
export interface RemotePruneGroupRun {
  /** Ordered invocations made for this group. */
  readonly steps: readonly CommandStepResult[];
  /** Whether every phase of this group succeeded. */
  readonly remoteResult: CommandRemoteResult;
  /** Refs this group confirmed absent and deleted locally. */
  readonly prunedRefs: readonly UpstreamDescriptor[];
  /** Refs this group could not confirm. */
  readonly unknownRefs: readonly UpstreamDescriptor[];
  /** Per-remote warnings. */
  readonly warnings: readonly string[];
  /** Refs fetched successfully. */
  readonly fetchedCount: number;
  /** Refs confirmed absent by the remote check, whether or not deletion succeeded. */
  readonly missingCount: number;
  /** True when an invocation for this group was cancelled. */
  readonly cancelled: boolean;
  /** True when an invocation for this group timed out. */
  readonly timedOut: boolean;
}

/** Accumulated result of every remote group. */
export interface RemotePruneRun {
  /** Ordered invocations across every group. */
  readonly steps: CommandStepResult[];
  /** Per-remote results. */
  readonly remoteResults: CommandRemoteResult[];
  /** Refs confirmed absent and deleted locally. */
  readonly prunedRefs: UpstreamDescriptor[];
  /** Refs whose presence or deletion could not be confirmed. */
  readonly unknownRefs: UpstreamDescriptor[];
  /** Per-remote and summary warnings. */
  readonly warnings: string[];
  /** Refs fetched successfully across every group. */
  fetchedCount: number;
  /** Refs confirmed absent across every group. */
  missingCount: number;
  /** Groups with at least one failed phase. */
  failedRemoteCount: number;
}
