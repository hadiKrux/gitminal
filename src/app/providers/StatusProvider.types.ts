import type { ReactNode } from "react";

/** Severity of a transient status message. */
export type StatusKind = "success" | "warning" | "error" | "info";

/** One transient message shown in the top bar status strip. */
export interface TransientStatus {
  /** Severity of the message. */
  readonly kind: StatusKind;
  /** Human-readable text. */
  readonly message: string;
}

/** Progress of the operation currently running, if any. */
export interface OperationProgress {
  /** Operation label, such as `fetch`. */
  readonly label: string;
  /** Current phase text. */
  readonly phase: string;
  /** Known percentage from 0 to 100, or `null` when git reports no progress. */
  readonly percent: number | null;
}

/** Which hint set the footer should show. */
export type FooterHintMode = "context" | "modal";

/** Complete status state owned by `StatusProvider`. */
export interface StatusState {
  /** Transient success, warning, error, or information message. */
  readonly status: TransientStatus | null;
  /** Running operation progress, or `null` when idle. */
  readonly operation: OperationProgress | null;
  /** Footer hint set selected by the active surface. */
  readonly hintMode: FooterHintMode;
}

/** Value exposed by `StatusProvider` and read through `useStatus`. */
export interface StatusContextValue extends StatusState {
  /** Shows a transient message and starts its dismissal timer. */
  readonly setStatus: (status: TransientStatus, durationMs?: number) => void;
  /** Clears the transient message and cancels its timer. */
  readonly clearStatus: () => void;
  /** Starts an operation and shows its first phase. */
  readonly beginOperation: (label: string) => void;
  /** Replaces the operation phase and percentage. */
  readonly updateOperation: (progress: { phase?: string; percent?: number | null }) => void;
  /** Ends the running operation. */
  readonly endOperation: () => void;
  /** Chooses the footer hint set. */
  readonly setHintMode: (mode: FooterHintMode) => void;
}

/** Props accepted by `StatusProvider`. */
export interface StatusProviderProps {
  /** Provider content. */
  readonly children?: ReactNode;
}
