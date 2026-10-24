import { useCallback, useMemo, useRef } from "react";
import type { InFlightTask, InFlightTaskOptions } from "@/app/hooks/useInFlightTask.types";

/**
 * Coalesces concurrent calls into one in-flight task.
 *
 * The first caller starts the task and receives its result. Later callers join the same promise and
 * receive the result decorated by `join`, normally with a `coalesced` flag. The settle callback runs
 * exactly once per started task, including when the task rejects, so a caller cannot leave an
 * in-flight flag latched.
 *
 * @param options - Start, settle, and join callbacks.
 * @returns The task slot.
 */
export function useInFlightTask<T>(options: InFlightTaskOptions<T>): InFlightTask<T> {
  const inFlightRef = useRef<Promise<T> | null>(null);
  const optionsRef = useRef(options);

  optionsRef.current = options;

  const run = useCallback((task: () => Promise<T>): Promise<T> => {
    const inFlight = inFlightRef.current;

    if (inFlight !== null) {
      return inFlight.then((result) => optionsRef.current.join(result));
    }

    optionsRef.current.onStart();

    const promise = task();

    inFlightRef.current = promise;

    return promise.finally(() => {
      if (inFlightRef.current === promise) {
        inFlightRef.current = null;
        optionsRef.current.onSettled();
      }
    });
  }, []);

  return useMemo(() => ({ run }), [run]);
}
