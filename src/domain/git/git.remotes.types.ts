import type { UpstreamDescriptor } from "@/domain/repository/repository.types";

/** Push variant selected by the command id. */
export type PushMode = "push" | "forceSafe" | "forceOverwrite" | "noVerify";

/** Inputs to the pure push planner. */
export interface PushPlanInput {
  /** Push variant. */
  readonly mode: PushMode;
  /** Branch being pushed, always the current branch. */
  readonly branch: string;
  /** Configured upstream of the branch, or null when none is configured. */
  readonly upstream: UpstreamDescriptor | null;
  /** Configured remote names. */
  readonly remotes: readonly string[];
}

/** Result of planning one push invocation. */
export type PushPlanResult =
  | { readonly ok: true; readonly args: readonly string[] }
  | { readonly ok: false; readonly error: string };

/** Options that narrow the upstream ref read. */
export interface ReadUpstreamGroupsOptions {
  /**
   * Local branch whose upstream refs are read, or null for every local branch.
   *
   * The comparison is exact, so a branch named `feature` never matches `feature/x`.
   */
  readonly localBranch?: string | null;
}

/** One distinct upstream ref grouped under its remote. */
export interface RemoteFetchGroup {
  /** Remote name, exactly as configured, including any slash it contains. */
  readonly remote: string;
  /** Distinct upstream refs for that remote, sorted by display ref for a stable argv. */
  readonly refs: readonly UpstreamDescriptor[];
}

/** Fetch and delete phases planned for one remote during Fetch --prune. */
export interface PrunePlan {
  /** In-scope upstream refs the remote still advertises, to fetch. */
  readonly fetchRefs: readonly UpstreamDescriptor[];
  /** In-scope upstream refs the remote no longer advertises, to delete locally. */
  readonly deleteRefs: readonly UpstreamDescriptor[];
}
