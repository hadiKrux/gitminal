import { useCallback, useState } from "react";

/**
 * Owns the composer's message-required attempt flag.
 *
 * The flag starts false, so an empty draft shows no error by default. A commit triggered while the
 * only missing piece is the message marks the attempt, which makes the composer show its inline
 * error. Any draft write clears it again, so the error never lingers while the user fixes the
 * message.
 *
 * @returns The attempt flag plus the mark and clear entry points.
 */
export function useComposerMessageAttempt(): {
  readonly attempted: boolean;
  readonly markAttempted: () => void;
  readonly clearAttempt: () => void;
} {
  const [attempted, setAttempted] = useState(false);
  const markAttempted = useCallback((): void => {
    setAttempted(true);
  }, []);
  const clearAttempt = useCallback((): void => {
    setAttempted(false);
  }, []);

  return { attempted, markAttempted, clearAttempt };
}
