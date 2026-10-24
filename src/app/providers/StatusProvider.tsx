import {
  createContext,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  FooterHintMode,
  OperationProgress,
  StatusContextValue,
  StatusProviderProps,
  StatusState,
  TransientStatus,
} from "@/app/providers/StatusProvider.types";

/** Default lifetime of a transient status message. */
const STATUS_DURATION_MS = 4000;

/** Status before any message or operation exists. */
const INITIAL_STATUS_STATE: StatusState = Object.freeze({
  status: null,
  operation: null,
  hintMode: "context",
});

/** Context carrying transient status, operation progress, and the footer hint mode. */
export const StatusContext = createContext<StatusContextValue | null>(null);

/**
 * Owns transient status messages, the running operation, and the footer hint mode.
 *
 * Success and information messages auto-dismiss through one shared timer; callers can pass a
 * shorter duration in tests. Operation progress never auto-dismisses and is cleared only by
 * `endOperation`, so the top bar cannot lose a still-running phase. The provider has no knowledge
 * of git or React features; the command orchestrator drives it later.
 *
 * @param props - Provider content.
 * @returns The status context provider.
 */
export function StatusProvider(props: StatusProviderProps): ReactNode {
  const [state, setState] = useState<StatusState>(INITIAL_STATUS_STATE);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Clears the pending auto-dismiss timer, if any. */
  const cancelStatusTimer = useCallback(() => {
    if (statusTimer.current !== null) {
      clearTimeout(statusTimer.current);
      statusTimer.current = null;
    }
  }, []);

  useEffect(() => cancelStatusTimer, [cancelStatusTimer]);

  /** Cancels the timer and clears the transient status. */
  const clearStatus = useCallback(() => {
    cancelStatusTimer();
    setState((previous) => (previous.status === null ? previous : { ...previous, status: null }));
  }, [cancelStatusTimer]);

  /** Shows a transient status and schedules its auto-dismiss. */
  const setStatus = useCallback(
    (status: TransientStatus, durationMs: number = STATUS_DURATION_MS) => {
      cancelStatusTimer();
      setState((previous) => ({ ...previous, status }));

      statusTimer.current = setTimeout(() => {
        statusTimer.current = null;
        setState((previous) => ({ ...previous, status: null }));
      }, durationMs);
    },
    [cancelStatusTimer],
  );

  /** Marks a new operation as running with no percentage yet. */
  const beginOperation = useCallback((label: string) => {
    setState((previous) => ({
      ...previous,
      operation: { label, phase: label, percent: null },
    }));
  }, []);

  /** Merges a phase or percentage into the running operation. */
  const updateOperation = useCallback((progress: { phase?: string; percent?: number | null }) => {
    setState((previous) => {
      if (previous.operation === null) {
        return previous;
      }

      const operation: OperationProgress = {
        label: previous.operation.label,
        phase: progress.phase ?? previous.operation.phase,
        percent: progress.percent === undefined ? previous.operation.percent : progress.percent,
      };

      return { ...previous, operation };
    });
  }, []);

  /** Clears the running operation. */
  const endOperation = useCallback(() => {
    setState((previous) =>
      previous.operation === null ? previous : { ...previous, operation: null },
    );
  }, []);

  /** Switches the footer between context hints and modal hints. */
  const setHintMode = useCallback((mode: FooterHintMode) => {
    setState((previous) =>
      previous.hintMode === mode ? previous : { ...previous, hintMode: mode },
    );
  }, []);

  const value = useMemo<StatusContextValue>(
    () => ({
      ...state,
      setStatus,
      clearStatus,
      beginOperation,
      updateOperation,
      endOperation,
      setHintMode,
    }),
    [state, setStatus, clearStatus, beginOperation, updateOperation, endOperation, setHintMode],
  );

  return <StatusContext.Provider value={value}>{props.children}</StatusContext.Provider>;
}
