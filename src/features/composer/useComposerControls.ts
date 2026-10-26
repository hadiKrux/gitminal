import { useCallback, useEffect, useState } from "react";
import { useAction } from "@/app/hooks/useAction";
import { useFocusState } from "@/app/hooks/useFocusState";
import { COMPOSER_TEXTAREA_ID } from "./composer.constants";
import type { ComposerControl } from "./composer.types";

/** Control order `nav.left` and `nav.right` step through. */
const COMPOSER_CONTROLS: readonly ComposerControl[] = Object.freeze(["message", "more", "commit"]);

/**
 * Owns the focused composer control, its left/right movement, and its activation.
 *
 * The right-pane region frame owns native focus, so the composer keeps its own control index. The
 * textarea reports its native focus through `FocusProvider` and resets the index to the message
 * control. `nav.left` and `nav.right` move without wrapping, and `nav.activate` focuses the textarea,
 * opens the options menu, or runs the primary commit for the current control.
 *
 * @param input - Textarea focus, menu opener, primary submit, and the committing flag.
 * @returns The focused control plus its movement and activation entry points.
 */
export function useComposerControls(input: {
  readonly openOptions: () => void;
  readonly submit: (commandId: string) => void;
  readonly committing: boolean;
}) {
  const { committing, openOptions, submit } = input;
  const { state: focusState, focusRenderable } = useFocusState();
  const [focusedControl, setFocusedControl] = useState<ComposerControl>("message");

  /** Focuses the composer textarea. */
  const focusTextarea = useCallback((): void => {
    focusRenderable(COMPOSER_TEXTAREA_ID);
  }, [focusRenderable]);

  /**
   * Moves the focused composer control without wrapping.
   *
   * @param delta - Negative to move left, positive to move right.
   */
  const moveControl = useCallback((delta: number): void => {
    setFocusedControl((current) => {
      const index = COMPOSER_CONTROLS.indexOf(current);
      const next = Math.min(Math.max(0, index + delta), COMPOSER_CONTROLS.length - 1);

      return COMPOSER_CONTROLS[next] ?? current;
    });
  }, []);

  /** Runs the focused composer control. */
  const activateFocusedControl = useCallback((): void => {
    if (committing) {
      return;
    }

    if (focusedControl === "message") {
      focusTextarea();

      return;
    }

    if (focusedControl === "more") {
      openOptions();

      return;
    }

    submit("commit.submit");
  }, [committing, focusTextarea, focusedControl, openOptions, submit]);

  useEffect(() => {
    if (focusState.focusedRenderableId === COMPOSER_TEXTAREA_ID) {
      setFocusedControl("message");
    }
  }, [focusState.focusedRenderableId]);

  useAction("nav.left", { scope: "right-pane", targetKind: "none" }, () => {
    moveControl(-1);
  });
  useAction("nav.right", { scope: "right-pane", targetKind: "none" }, () => {
    moveControl(1);
  });
  useAction("nav.activate", { scope: "right-pane", targetKind: "none" }, activateFocusedControl);

  return { focusedControl, focusTextarea, moveControl, activateFocusedControl };
}
