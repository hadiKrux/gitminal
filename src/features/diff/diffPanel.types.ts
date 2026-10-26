import type { MutableRefObject } from "react";
import type {
  CommandAvailability,
  CommandFormValues,
  CommandTarget,
} from "@/domain/commands/commands.types";
import type { DiffSection } from "@/domain/diff/diff.types";
import type { DiffFileView, DiffSectionView } from "@/domain/repository/repository.types";

/** One remembered file row inside a section. */
export interface RememberedFile {
  /** Section the file row belongs to. */
  readonly section: DiffSection;
  /** Stable row identity. */
  readonly id: string;
}

/** Refs shared with `useDiffExpansionEffects` after the rows exist. */
export interface DiffExpansionRefs {
  /** File row remembered for a collapsed section. */
  readonly rememberedFileRef: MutableRefObject<RememberedFile | null>;
  /** Row id to select after a section expands again. */
  readonly pendingRestoreRef: MutableRefObject<string | null>;
  /** File id the automatic reveal already expanded. */
  readonly autoExpandRef: MutableRefObject<string | null>;
  /** True while the automatic reveal still has to collapse itself if the read is not text. */
  readonly autoCollapsePendingRef: MutableRefObject<boolean>;
}

/** One row the diff cursor can address: a section header or a file. */
export interface DiffRow {
  /** Stable row identity. */
  readonly id: string;
  /** Row kind. */
  readonly kind: "section" | "file";
  /** Section the row belongs to. */
  readonly section: DiffSection;
  /** File model for a file row, or null for a section header. */
  readonly file: DiffFileView | null;
}

/** One inline action a row or header renders. */
export interface DiffActionView {
  /** Stable action identity. */
  readonly id: string;
  /** Visible label. */
  readonly label: string;
  /** True when the action cannot run for the current target. */
  readonly disabled: boolean;
  /** Disabled reason text, when unavailable. */
  readonly reason?: string;
  /** Activation callback. */
  readonly onPress: () => void;
}

/**
 * Callbacks an inline or bulk action needs.
 *
 * Availability reads, blocked-reason reporting, and dispatch are shared by the immediate action path
 * and the destructive confirmation path, so both use this one shape.
 */
export interface DiffCommandHandlers {
  /** Reads one command's availability for a file target. */
  readonly readFileAvailability: (commandId: string, file: DiffFileView) => CommandAvailability;
  /** Reads one command's availability for a section target. */
  readonly readSectionAvailability: (
    commandId: string,
    view: DiffSectionView,
  ) => CommandAvailability;
  /** Reports a blocked availability result. */
  readonly reportAvailability: (availability: CommandAvailability) => void;
  /** Sends one request to the command runner. */
  readonly dispatch: (
    commandId: string,
    target: CommandTarget,
    formValues?: CommandFormValues,
  ) => void;
}

/** Overlay writer a destructive confirmation needs. */
export interface ConfirmationOverlay {
  /** Opens a destructive confirmation. */
  readonly confirm: (input: {
    readonly title: string;
    readonly description: string;
    readonly confirmLabel: string;
    readonly destructive: boolean;
    readonly onConfirm: () => void;
  }) => void;
}

/** Callbacks a row action needs. */
export interface FileActionHandlers {
  /** Reads availability for one command and file. */
  readonly readFileAvailability: (commandId: string, file: DiffFileView) => CommandAvailability;
  /** Runs a non-destructive file action. */
  readonly runFileAction: (commandId: string, file: DiffFileView) => void;
  /** Opens the destructive confirmation for one file. */
  readonly confirmFileAction: (
    commandId: "diff.discard" | "diff.deleteUntracked",
    file: DiffFileView,
  ) => void;
}

/** Callbacks a bulk action needs. */
export interface BulkActionHandlers {
  /** Reads availability for one command and section. */
  readonly readSectionAvailability: (
    commandId: string,
    view: DiffSectionView,
  ) => CommandAvailability;
  /** Runs a non-destructive bulk action. */
  readonly runBulkAction: (commandId: string, view: DiffSectionView) => void;
  /** Opens the destructive confirmation for one section. */
  readonly confirmBulkAction: (
    commandId: "diff.discardAll" | "diff.deleteAllUntracked",
    view: DiffSectionView,
  ) => void;
}
