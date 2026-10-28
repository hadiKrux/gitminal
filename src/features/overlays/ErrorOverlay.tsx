import { type ReactNode, useCallback, useState } from "react";
import { useAction } from "@/app/hooks/useAction";
import {
  ERROR_DETAILS_ROWS,
  ERROR_DISMISS_ID,
  ERROR_DISMISS_LABEL,
  ERROR_OPEN_CONSOLE_ID,
  ERROR_OPEN_CONSOLE_LABEL,
  ERROR_OVERLAY_FRAME_ID,
  ERROR_OVERLAY_HEIGHT,
  ERROR_OVERLAY_WIDTH,
  ERROR_RETRY_ID,
  ERROR_RETRY_LABEL,
} from "@/features/overlays/ErrorOverlay.constants";
import type { ErrorOverlayProps } from "@/features/overlays/ErrorOverlay.types";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import type { ButtonProps } from "@/ui/Button.types";
import { ModalActions } from "@/ui/ModalActions";
import { ModalFrame } from "@/ui/ModalFrame";
import { useScrollbarOptions } from "@/ui/useScrollbarOptions";

/**
 * Renders the persistent error overlay for a failed command.
 *
 * The detail is stored only after redaction, so this component never sees a credential. The body is
 * a bounded `<scrollbox>`, so a large git output does not force the frame to grow. Actions render as
 * Dismiss, Open console entry, and Retry in that order; Retry is included only when re-running the
 * command is meaningful. The overlay owns `nav.left`, `nav.right`, and `nav.activate` in the overlay
 * scope, exactly like a confirmation, and `overlay.close` remains the global dismiss path.
 *
 * @param props - Redacted failure text, available actions, and their callbacks.
 * @returns The error overlay.
 */
export function ErrorOverlay(props: ErrorOverlayProps): ReactNode {
  const tokens = useTokens();
  const scrollbarOptions = useScrollbarOptions();
  const [focusedIndex, setFocusedIndex] = useState(0);
  const actions = buildActions(props, focusedIndex);

  /** Focuses the previous action. */
  const moveLeft = useCallback((): void => {
    setFocusedIndex((index) => Math.max(0, index - 1));
  }, []);

  /** Focuses the next action. */
  const moveRight = useCallback((): void => {
    setFocusedIndex((index) => Math.min(actions.length - 1, index + 1));
  }, [actions.length]);

  /** Runs the focused action. */
  const activate = useCallback((): void => {
    actions[focusedIndex]?.onPress?.();
  }, [actions, focusedIndex]);

  useAction("nav.left", { scope: "overlay" }, moveLeft);
  useAction("nav.right", { scope: "overlay" }, moveRight);
  useAction("nav.activate", { scope: "overlay" }, activate);

  return (
    <ModalFrame
      id={ERROR_OVERLAY_FRAME_ID}
      title={props.title}
      description={props.message}
      width={ERROR_OVERLAY_WIDTH}
      height={ERROR_OVERLAY_HEIGHT}
    >
      <box flexDirection="column" flexGrow={1} minHeight={3}>
        <text fg={tokens.muted} wrapMode="none">
          {`${ICONS.error} Details`}
        </text>
        <scrollbox
          id={`${ERROR_OVERLAY_FRAME_ID}-details`}
          height={ERROR_DETAILS_ROWS}
          flexShrink={0}
          focusable={false}
          viewportCulling
          scrollbarOptions={scrollbarOptions}
        >
          <text fg={tokens.muted} wrapMode="word">
            {props.details}
          </text>
        </scrollbox>
      </box>
      <ModalActions actions={actions} />
    </ModalFrame>
  );
}

/**
 * Builds the error actions in display order.
 *
 * @param props - Error callbacks and availability flags.
 * @param focusedIndex - Currently focused action index.
 * @returns The visible actions with their focus state.
 */
function buildActions(props: ErrorOverlayProps, focusedIndex: number): readonly ButtonProps[] {
  const actions: ButtonProps[] = [
    {
      id: ERROR_DISMISS_ID,
      label: ERROR_DISMISS_LABEL,
      focused: focusedIndex === 0,
      onPress: props.onDismiss,
    },
    {
      id: ERROR_OPEN_CONSOLE_ID,
      label: ERROR_OPEN_CONSOLE_LABEL,
      focused: focusedIndex === 1,
      disabled: props.consoleEntryId === null,
      reason: props.consoleEntryId === null ? "no console entry" : undefined,
      onPress: props.consoleEntryId === null ? undefined : props.onOpenConsole,
    },
  ];

  if (props.canRetry) {
    actions.push({
      id: ERROR_RETRY_ID,
      label: ERROR_RETRY_LABEL,
      focused: focusedIndex === 2,
      onPress: props.onRetry,
    });
  }

  return actions;
}
