import type { ReactNode } from "react";
import type { StatusKind } from "@/app/hooks/useStatus";
import type { CommandAvailability, CommandTarget } from "@/domain/commands/commands.types";
import type { SyncState } from "@/domain/repository/repository.types";

/** Availability reader bound to the current repository state. */
export type TopBarAvailabilityReader = (
  commandId: string,
  target: CommandTarget,
) => CommandAvailability;

/** Inputs for the top bar's command routing. */
export interface TopBarCommandsInput {
  /** Current branch name. */
  readonly branch: string;
  /** Configured upstream ref, or null. */
  readonly upstreamRef: string | null;
  /** Availability reader bound to the current repository state. */
  readonly getAvailability: TopBarAvailabilityReader;
}

/** Command routing returned to the top bar. */
export interface TopBarCommands {
  /**
   * Runs a command after a fresh availability pre-check.
   *
   * @param commandId - Command id to run.
   * @param expectedBranch - Branch the caller captured; a mismatch aborts with a warning.
   */
  readonly dispatch: (commandId: string, expectedBranch?: string) => void;
  /** Routes a user request, confirming the force variants first. */
  readonly activateCommand: (commandId: string) => void;
}

/** Kind of control in the top-bar action strip. */
export type TopBarControlKind = "info" | "pull" | "push" | "more";

/** One control in the `nav.left`/`nav.right` order. */
export interface TopBarControl {
  /** Control kind; `info` is the branch block and has no action. */
  readonly kind: TopBarControlKind;
  /** Visible label. */
  readonly label: string;
  /** Optional leading marker from `ICONS`. */
  readonly icon?: string;
  /** Whether activating the control can run its command. */
  readonly available: boolean;
  /** Display text for the unavailable reason, or null when available. */
  readonly reason: string | null;
}

/** One option in the More remote actions menu. */
export interface TopBarMoreOption {
  /** Explicit command id dispatched by the option; never a raw key. */
  readonly commandId: string;
  /** Visible option name. */
  readonly label: string;
  /** Normal description when available, or the availability reason when not. */
  readonly description: string;
  /** Whether the option can run. */
  readonly available: boolean;
  /** Display text for the unavailable reason, or null when available. */
  readonly reason: string | null;
}

/** Running-operation mode of the status strip. */
export interface TopBarOperationStatus {
  /** Discriminator. */
  readonly kind: "operation";
  /** Operation label, such as `Fetch`. */
  readonly label: string;
  /** Current git phase. */
  readonly phase: string;
  /** Known percentage, or null when git reports none. */
  readonly percent: number | null;
}

/** Transient-message mode of the status strip. */
export interface TopBarMessageStatus {
  /** Discriminator. */
  readonly kind: "status";
  /** Message severity. */
  readonly statusKind: StatusKind;
  /** Message text. */
  readonly message: string;
}

/** Idle branch-info mode of the status strip. */
export interface TopBarIdleStatus {
  /** Discriminator. */
  readonly kind: "idle";
  /** True before the first repository read settles. */
  readonly loading: boolean;
  /**
   * Redacted error from a failed first read, or null.
   *
   * It is set only while `loading` is true and no snapshot exists, so a failed initial read shows a
   * visible error instead of an indefinite "loading repository". The error overlay still owns
   * later command failures; this is a status-strip fallback only.
   */
  readonly initialError: string | null;
  /**
   * True for terminal repository states such as not-a-repository or a bare repository.
   *
   * The strip renders only the state label: there is no branch, no counts, and no sync badge to show.
   */
  readonly gated: boolean;
  /** Branch name, or the detached short hash. */
  readonly branchLabel: string;
  /** True for a detached HEAD. */
  readonly detached: boolean;
  /** Configured upstream label, or null when none exists. */
  readonly upstreamLabel: string | null;
  /** True when the configured upstream ref is missing, unconfirmed, or deleted. */
  readonly upstreamMissing: boolean;
  /** Commits ahead of the upstream. */
  readonly ahead: number;
  /** Commits behind the upstream. */
  readonly behind: number;
  /** Sync relationship shown by `SyncStateBadge`. */
  readonly sync: SyncState;
  /** Repository state label when the repository is not normal, or null. */
  readonly stateLabel: string | null;
}

/** The one mode the status strip renders. */
export type TopBarStatusMode = TopBarOperationStatus | TopBarMessageStatus | TopBarIdleStatus;

/** Inputs supplied to the More menu renderer. */
export interface TopBarMoreMenuRenderInput {
  /** Closes the menu without dispatching. */
  readonly close: () => void;
  /** Routes an option's explicit command id, opening a confirmation when required. */
  readonly activate: (commandId: string) => void;
}

/** Options accepted by `useTopBar`. */
export interface UseTopBarOptions {
  /**
   * Builds the More menu content.
   *
   * The JSX lives in a `.tsx` module so this hook stays free of JSX; the hook supplies the current
   * options plus the close and activate helpers.
   *
   * @param input - Current options and helpers.
   * @returns The More menu node.
   */
  readonly renderMoreMenu: (input: TopBarMoreMenuRenderInput) => ReactNode;
}

/** Value returned by `useTopBar`. */
export interface TopBarHandle {
  /** Controls in `nav.left`/`nav.right` order, including `info` while the strip is idle. */
  readonly controls: readonly TopBarControl[];
  /** Stable focused control kind, independent of whether the idle info stop is visible. */
  readonly focusedKind: TopBarControlKind;
  /** Index of the focused kind in the current list, or -1 when that control is hidden. */
  readonly focusedIndex: number;
  /** The single status-strip mode. */
  readonly statusMode: TopBarStatusMode;
  /** Focuses a control by index and activates it; the info control is a no-op. */
  readonly activateControl: (index: number) => void;
}
