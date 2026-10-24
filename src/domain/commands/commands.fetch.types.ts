import type { CommandRemoteResult, CommandStepResult } from "./commands.types";

/** One distinct upstream ref grouped under its remote. */
export interface RemoteFetchGroup {
  /** Remote name. */
  readonly remote: string;
  /** Distinct upstream refs for that remote, sorted for a stable argv. */
  readonly refs: readonly string[];
}

/** Result of fetching one remote group. */
export interface RemoteFetchRun {
  /** Ordered invocations made for this remote. */
  readonly steps: readonly CommandStepResult[];
  /** Non-fatal warnings raised by this remote's refs. */
  readonly warnings: readonly string[];
  /** Whether the remote was reached for every ref it was asked to fetch. */
  readonly remoteResult: CommandRemoteResult;
  /** True when an invocation for this remote was cancelled. */
  readonly cancelled: boolean;
  /** True when an invocation for this remote timed out. */
  readonly timedOut: boolean;
}
