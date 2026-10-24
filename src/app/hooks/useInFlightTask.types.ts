/** Options accepted by `useInFlightTask`. */
export interface InFlightTaskOptions<T> {
  /** Called before a new task starts. */
  readonly onStart: () => void;
  /** Called when the task settles, whether it resolves or rejects. */
  readonly onSettled: () => void;
  /** Decorates a result returned to a caller that joined an in-flight task. */
  readonly join: (result: T) => T;
}

/** One coalescing task slot. */
export interface InFlightTask<T> {
  /**
   * Starts a task, or joins the in-flight one.
   *
   * @param task - Work to run when no task is in flight.
   * @returns Its result, decorated when this caller joined.
   */
  run(task: () => Promise<T>): Promise<T>;
}
