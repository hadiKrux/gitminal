import type { ButtonProps } from "@/ui/Button.types";

/** Props accepted by the Create Stash modal. */
export interface CreateStashModalProps {
  /** Stable field id the panel focuses when the modal opens. */
  readonly messageFieldId: string;
  /** Deterministic prefill from the current repository state. */
  readonly initialMessage: string;
  /** Configured default for the Include untracked files checkbox. */
  readonly includeUntrackedByDefault: boolean;
  /** Overlay close callback. */
  readonly onClose: () => void;
  /** Panel callback that runs the create command. */
  readonly onCreate: (values: {
    readonly message: string;
    readonly includeUntracked: boolean;
  }) => void;
}

/** Form state and handlers returned by `useCreateStashModal`. */
export interface CreateStashFormHandle {
  /** Current draft message. */
  readonly message: string;
  /** Current checkbox state. */
  readonly includeUntracked: boolean;
  /** Inline message error, or null. */
  readonly error: string | null;
  /** Live create availability reason, or null when the form may run. */
  readonly availabilityText: string | null;
  /** Footer actions in display order. */
  readonly actions: readonly ButtonProps[];
  /** Updates the draft message and clears a stale error. */
  handleMessageInput(value: string): void;
  /** Submits the current form. */
  submit(): void;
  /** Toggles the Include untracked files checkbox. */
  toggleUntracked(): void;
}
