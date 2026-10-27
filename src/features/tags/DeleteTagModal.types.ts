import type { TagRowRecord } from "@/domain/git/git.types";
import type { ButtonProps } from "@/ui/Button.types";

/** Delete scope sent in the command form values. */
export type DeleteScope = "local" | "local-remote" | "remote";

/** One focusable control of the modal, in navigation order. */
export type DeleteControl = "scope" | "remote" | "cancel" | "confirm";

/** One scope choice offered by the modal. */
export interface DeleteScopeOption {
  /** Display label. */
  readonly label: string;
  /** Scope value sent in the command form values. */
  readonly value: DeleteScope;
  /** Optional explanation shown under the label. */
  readonly description?: string;
}

/** Props accepted by the Delete Tag modal. */
export interface DeleteTagModalProps {
  /** Merged tag row opened by the panel. */
  readonly row: TagRowRecord;
  /** Overlay close callback. */
  readonly onClose: () => void;
}

/** State and handlers returned by `useDeleteTagModal`. */
export interface DeleteTagModalHandle {
  /** Control that currently owns the keyboard focus. */
  readonly control: DeleteControl;
  /** Scope choices in display order. */
  readonly scopeOptions: readonly DeleteScopeOption[];
  /** Selected scope. */
  readonly scope: DeleteScope;
  /** Selected remote. */
  readonly remote: string;
  /** True when the selected remote scope has no known remote. */
  readonly remoteMissing: boolean;
  /** True when the selected scope needs a remote. */
  readonly requiresRemote: boolean;
  /** True when the remote picker is rendered. */
  readonly showRemotePicker: boolean;
  /** Footer actions in display order. */
  readonly actions: readonly ButtonProps[];
  /** Consequence text for the selected scope. */
  readonly consequence: string;
  /** Records a scope value reported by native navigation without moving focus. */
  selectScope(value: string): void;
  /** Records a remote value reported by native navigation without moving focus. */
  selectRemote(value: string): void;
  /** Records a confirmed scope value and returns native focus to the modal frame. */
  confirmScope(value: string): void;
  /** Records a confirmed remote value and returns native focus to the modal frame. */
  confirmRemote(value: string): void;
}
