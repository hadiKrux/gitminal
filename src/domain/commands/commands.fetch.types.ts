import type { CommandRemoteResult, CommandStepResult } from "./commands.types";

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
