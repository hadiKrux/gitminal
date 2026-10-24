import { type ReactNode, useCallback, useState } from "react";
import { useAction } from "@/app/hooks/useAction";
import {
  CONFIRM_CANCEL_ID,
  CONFIRM_CANCEL_LABEL,
  CONFIRM_MODAL_FRAME_ID,
  CONFIRM_MODAL_WIDTH,
  CONFIRM_PRIMARY_ID,
} from "@/features/overlays/ConfirmModal.constants";
import type { ButtonProps } from "@/ui/Button.types";
import { ModalActions } from "@/ui/ModalActions";
import { ModalFrame } from "@/ui/ModalFrame";

/**
 * Renders a modal confirmation with a stable two-action footer.
 *
 * A destructive confirmation starts with Cancel focused so the dangerous action is never the
 * default; a non-destructive confirmation starts on the primary action. The footer order stays
 * Cancel then primary, `nav.left` and `nav.right` move the focused action, and `nav.activate` runs
 * it. Only the primary action calls `onConfirm`; Cancel calls `onCancel`. `Esc` is not handled here,
 * because the global `overlay.close` handler owns it.
 *
 * The overlay-scope handlers are registered by this component because it owns both the focused
 * action index and the confirmation lifecycle. The overlay host mounts it only for confirm entries,
 * so no other overlay content can register a competing overlay-scope handler, and switching entries
 * cannot create a duplicate `(actionId, scope)` registration.
 *
 * @param props - Entry title, description, exact confirm label, destructiveness, and callbacks.
 * @returns The confirmation modal.
 */
export function ConfirmModal(props: {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly destructive: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}): ReactNode {
  const [focusedIndex, setFocusedIndex] = useState(() => (props.destructive ? 0 : 1));
  const actions = buildActions(props, focusedIndex);

  /** Focuses the previous footer action. */
  const moveLeft = useCallback((): void => {
    setFocusedIndex((index) => Math.max(0, index - 1));
  }, []);

  /** Focuses the next footer action. */
  const moveRight = useCallback((): void => {
    setFocusedIndex((index) => Math.min(actions.length - 1, index + 1));
  }, [actions.length]);

  /** Runs the focused footer action. */
  const activate = useCallback((): void => {
    const action = actions[focusedIndex];

    action?.onPress?.();
  }, [actions, focusedIndex]);

  useAction("nav.left", { scope: "overlay" }, moveLeft);
  useAction("nav.right", { scope: "overlay" }, moveRight);
  useAction("nav.activate", { scope: "overlay" }, activate);

  return (
    <ModalFrame
      id={CONFIRM_MODAL_FRAME_ID}
      title={props.title}
      description={props.description}
      width={CONFIRM_MODAL_WIDTH}
    >
      <box flexGrow={1} />
      <ModalActions actions={actions} />
    </ModalFrame>
  );
}

/**
 * Builds the footer actions in display order.
 *
 * @param props - Confirmation props supplying the labels and callbacks.
 * @param focusedIndex - Currently focused action.
 * @returns Cancel and primary actions with their focus flags.
 */
function buildActions(
  props: {
    readonly confirmLabel: string;
    readonly onConfirm: () => void;
    readonly onCancel: () => void;
  },
  focusedIndex: number,
): readonly ButtonProps[] {
  return [
    {
      id: CONFIRM_CANCEL_ID,
      label: CONFIRM_CANCEL_LABEL,
      focused: focusedIndex === 0,
      onPress: props.onCancel,
    },
    {
      id: CONFIRM_PRIMARY_ID,
      label: props.confirmLabel,
      focused: focusedIndex === 1,
      onPress: props.onConfirm,
    },
  ];
}
