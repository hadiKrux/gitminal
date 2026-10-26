import type { ReactNode } from "react";
import type { CommandAvailabilityReason } from "@/domain/commands/commands.types";
import type { GitIdentity } from "@/domain/git/git.types";

/** Focused composer control when the right-pane region frame owns focus. */
export type ComposerControl = "message" | "more" | "commit";

/** One menu variant as the options menu renders it. */
export interface ComposerVariantOption {
  /** Stable command id. */
  readonly commandId: string;
  /** Visible label. */
  readonly label: string;
  /** One-line description. */
  readonly description: string;
  /** True when the variant may run. */
  readonly available: boolean;
  /** Disabled reason text, or null when available. */
  readonly reason: string | null;
}

/** Control the options menu steps through with Up and Down. */
export type MenuControl = "select" | "run" | "cancel";

/** One variant row rendered by the options menu. */
export type MenuVariant = ComposerVariantOption;

/** Props the composer passes when it opens the options menu. */
export interface CommitOptionsMenuProps {
  /** Variant rows in product order. */
  readonly variants: readonly MenuVariant[];
  /** Reports the highlighted variant so the composer can load its amend state. */
  readonly onHighlight: (commandId: string) => void;
  /** Runs the selected variant. */
  readonly onRun: (commandId: string) => void;
  /** Cancels the menu and restores the pre-menu draft. */
  readonly onCancel: () => void;
  /** Restores the pre-menu draft when the overlay closes for any other reason. */
  readonly onDismiss: () => void;
}

/** Renderer the component supplies for the options overlay. */
export type ComposerMenuRenderer = (input: {
  readonly variants: readonly ComposerVariantOption[];
  readonly onHighlight: (commandId: string) => void;
  readonly onRun: (commandId: string) => void;
  readonly onCancel: () => void;
  readonly onDismiss: () => void;
}) => ReactNode;

/** Input to the pure composer enablement rule. */
export interface ComposerEnablementInput {
  /** Current draft text. */
  readonly draft: string;
  /** Number of staged files. */
  readonly stagedCount: number;
  /** Configured commit identity. */
  readonly identity: GitIdentity;
  /** True when HEAD exists. */
  readonly headExists: boolean;
  /** True for an amend variant. */
  readonly amend: boolean;
  /** True while a commit is running. */
  readonly committing: boolean;
}

/** Result of the pure composer enablement rule. */
export interface ComposerEnablement {
  /** True when the variant may run. */
  readonly available: boolean;
  /** Shared blocked reason, or null when available. */
  readonly reason: CommandAvailabilityReason | null;
}

/** One menu session: the draft to restore and the loaded amend message. */
export interface ComposerMenuSession {
  /** Draft captured when the menu opened. */
  readonly snapshot: string;
  /** Loaded previous commit message and short hash, or null before the load. */
  amendLoad: { readonly message: string; readonly shortHash: string } | null;
}

/**
 * Result of reading HEAD's message and short hash for an amend.
 *
 * A cancelled or superseded read is distinct from a real failure so the caller can stay silent when
 * the user closed the menu or pressed Run before the read settled.
 */
export type AmendHeadRead =
  | { readonly ok: true; readonly message: string; readonly shortHash: string }
  | { readonly ok: false; readonly cancelled: boolean };

/** Presentation flags the composer derives from its enablement and draft state. */
export interface ComposerViewFlags {
  /** True when the textarea must refuse focus. */
  readonly textareaDisabled: boolean;
  /** True when the Commit button is disabled. */
  readonly commitDisabled: boolean;
  /** Reason shown on the Commit button, or undefined when the button needs no tooltip. */
  readonly commitReason: string | undefined;
  /** True when the inline state line explains a missing identity or running operation. */
  readonly showStateText: boolean;
}

/** Input to the composer presentation rule. */
export interface ComposerViewInput {
  /** True while a commit runs. */
  readonly committing: boolean;
  /** Number of staged files. */
  readonly stagedCount: number;
  /** Loaded amend short hash, or null outside amend. */
  readonly amendShortHash: string | null;
  /** Shared primary blocked reason, or null when the normal commit may run. */
  readonly primaryReason: CommandAvailabilityReason | null;
  /** Human-readable text for the primary reason. */
  readonly blockedReason: string | null;
}
