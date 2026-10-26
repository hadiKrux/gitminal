/** One focusable control of the New Worktree modal, in navigation order. */
export type NewWorktreeControl =
  | "path"
  | "mode"
  | "branch"
  | "existing-branch"
  | "cancel"
  | "confirm";

/** One inline validation message and the field that shows it. */
export interface NewWorktreeFieldError {
  /** Field that owns the message. */
  readonly field: "path" | "branch";
  /** User-facing message. */
  readonly message: string;
}

/** Props accepted by the New Worktree modal. */
export interface NewWorktreeModalProps {
  /** Overlay close callback. */
  readonly onClose: () => void;
}
