/** Runtime settings shared by every invocation of one git client. */
export interface GitExecutionSettings {
  /** Grace between `SIGTERM` and `SIGKILL`. */
  readonly killGraceMs: number;
  /**
   * Grace after a normal child exit while waiting for the `close` event.
   *
   * `close` only fires when every holder of the stdout and stderr pipes closes them, so a
   * backgrounded descendant can delay it forever. The invocation settles with the captured output
   * after this grace even when `close` never arrives.
   */
  readonly exitFlushGraceMs: number;
  /** Maximum captured characters per stream. */
  readonly outputLimitCharacters: number;
  /** Clock used for duration measurement. */
  readonly now: () => number;
}

/** One queued index-lock waiter. */
export interface GitIndexLockWaiter {
  /** True when the waiter needs exclusive access. */
  readonly exclusive: boolean;
  /** Resolves the waiter with its release function. */
  readonly grant: () => void;
}

/** Read-write latch serializing index-touching reads against writes. */
export interface GitIndexLock {
  /** Number of active shared readers. */
  readers: number;
  /** True while one exclusive writer is active. */
  writer: boolean;
  /** Waiters in arrival order. */
  readonly waiters: GitIndexLockWaiter[];
}
