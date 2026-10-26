import { useRenderer } from "@opentui/react";
import { useAction } from "@/app/hooks/useAction";
import { useCommandRunner } from "@/app/hooks/useCommandRunner";
import { useConsoleLog } from "@/app/hooks/useConsoleLog";
import { useFocusState } from "@/app/hooks/useFocusState";
import { clearFocusedInput } from "@/app/hooks/useInputEscapeClear";
import { useOverlay } from "@/app/hooks/useOverlay";
import { useRepository } from "@/app/hooks/useRepository";
import { useStatus } from "@/app/hooks/useStatus";
import { selectComposerVisible } from "@/domain/repository/repository.selectors";
import { COMPOSER_TEXTAREA_ID } from "@/features/composer/useComposer";
import type { RegionId } from "@/features/shell/focus.types";

/**
 * Registers the global shell actions that the composition root owns.
 *
 * Quit, commit focus, Esc-to-close, and the console toggle all need the renderer, focus, status,
 * overlay, console, repository, and command-runner providers together. Keeping them in one hook
 * leaves `AppShellHost` as layout composition only, and the four handlers stay registered once, in
 * the same order they always were.
 */
export function useShellActions(): void {
  const renderer = useRenderer();
  const { status, clearStatus } = useStatus();
  const overlay = useOverlay();
  const { state, focusRegion, focusRenderable } = useFocusState();
  const consoleLog = useConsoleLog();
  const commandRunner = useCommandRunner();
  const repository = useRepository();

  useAction("app.quit", { scope: "global", owner: "app" }, () => {
    void (async () => {
      // Draft-based quit confirmation is still deferred. Until it lands, quit aborts the child and
      // waits for it to settle before tearing down the renderer.
      await commandRunner.abort();
      renderer.destroy();
    })();
  });

  useAction("commit.focus", { scope: "global", owner: "app" }, () => {
    // The composer, and therefore its textarea, mounts only while the right pane is the composer.
    if (selectComposerVisible(repository.selection)) {
      focusRenderable(COMPOSER_TEXTAREA_ID);
    }
  });

  useAction("overlay.close", { scope: "global", owner: "app" }, () => {
    if (overlay.isOpen) {
      // A focused surface may consume the first Esc for a documented clear, exactly like the
      // non-overlay branch below. Help registers one while its search has text, so Esc clears the
      // query and only the next Esc closes the modal.
      if (clearFocusedInput(state.focusedRenderableId)) {
        return;
      }

      overlay.close();

      return;
    }

    closeTransientSurface({
      hasStatus: status !== null,
      clearStatus,
      consoleOpen: consoleLog.isOpen,
      closeConsole: () => {
        consoleLog.close();
        returnFromConsoleFocus(state.previousRegion, focusRegion);
      },
      clearFocusedInput: () => clearFocusedInput(state.focusedRenderableId),
      returnFromTextInput: () => {
        if (state.textInputFocused && state.activeRegion !== null) {
          focusRegion(state.activeRegion);

          return true;
        }

        return false;
      },
      returnToPreviousRegion: () => {
        if (state.previousRegion !== null && state.previousRegion !== state.activeRegion) {
          focusRegion(state.previousRegion);
        }
      },
    });
  });

  useAction("app.console", { scope: "global", owner: "app" }, () => {
    if (consoleLog.isOpen && state.focusInsideRegion && state.activeRegion === "console") {
      consoleLog.close();
      returnFromConsoleFocus(state.previousRegion, focusRegion);

      return;
    }

    consoleLog.toggle();
  });
}

/**
 * Closes the transient surface Esc owns when no overlay is open.
 *
 * A status message is cleared first, then an open console drawer closes, then a focused text input
 * that registered a first-Esc clear clears and keeps focus, then a focused text input returns focus
 * to its region, and finally focus returns to the previous region. The callbacks own the provider
 * writes so this function stays a small, testable branch table.
 *
 * @param input - Whether each surface is active plus the callbacks that close it.
 */
function closeTransientSurface(input: {
  readonly hasStatus: boolean;
  readonly clearStatus: () => void;
  readonly consoleOpen: boolean;
  readonly closeConsole: () => void;
  readonly clearFocusedInput: () => boolean;
  readonly returnFromTextInput: () => boolean;
  readonly returnToPreviousRegion: () => void;
}): void {
  if (input.hasStatus) {
    input.clearStatus();
  }

  if (input.consoleOpen) {
    input.closeConsole();

    return;
  }

  if (input.clearFocusedInput()) {
    return;
  }

  if (input.returnFromTextInput()) {
    return;
  }

  input.returnToPreviousRegion();
}

/**
 * Returns focus to the region that owned it before the console opened.
 *
 * The console region unmounts when the drawer closes, so waiting for the next focus action would
 * leave focus nowhere. The console itself is never a valid restore target.
 *
 * @param previousRegion - Region active before the console opened, or null.
 * @param focusRegion - Native focus helper for a region frame.
 */
function returnFromConsoleFocus(
  previousRegion: RegionId | null,
  focusRegion: (region: RegionId) => void,
): void {
  if (previousRegion !== null && previousRegion !== "console") {
    focusRegion(previousRegion);
  }
}
