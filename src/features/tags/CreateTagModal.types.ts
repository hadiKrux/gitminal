import type { TextareaRenderable } from "@opentui/core";
import type { RefObject } from "react";
import type { ButtonProps } from "@/ui/Button.types";

/** Props accepted by the Create Tag modal. */
export interface CreateTagModalProps {
  /** Overlay close callback. */
  readonly onClose: () => void;
}

/** Form state and handlers returned by `useCreateTagModal`. */
export interface CreateTagFormHandle {
  /** Current name draft. */
  readonly name: string;
  /** Inline name error, or null. */
  readonly error: string | null;
  /** True when the optional push is selected and a remote exists. */
  readonly pushAfterCreate: boolean;
  /** True when no remote is configured, so the push checkbox is disabled. */
  readonly pushDisabled: boolean;
  /** Read-only target label. */
  readonly targetLabel: string;
  /** Checkbox label naming the remote that would receive the tag. */
  readonly pushLabel: string;
  /** Ref for the optional annotated-tag message textarea. */
  readonly messageRef: RefObject<TextareaRenderable | null>;
  /** Footer actions in display order. */
  readonly actions: readonly ButtonProps[];
  /** Updates the name draft and clears a stale error. */
  handleNameInput(value: string): void;
  /** Submits the current form. */
  submit(): void;
  /** Toggles the optional post-create push. */
  togglePush(): void;
}
