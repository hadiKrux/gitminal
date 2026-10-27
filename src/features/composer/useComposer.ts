import { useCallback, useEffect, useRef } from "react";
import { publishActionAvailability } from "@/app/hooks/useActionAvailability";
import { useDraft } from "@/app/hooks/useDraft";
import { useFocusRegion } from "@/app/hooks/useFocusRegion";
import { useRepository } from "@/app/hooks/useRepository";
import { selectPendingCounts } from "@/domain/repository/repository.selectors";
import { readComposerCommandState, readMissingIdentity } from "./composer.commands";
import {
  COMPOSER_COMMIT_BUTTON_ID,
  COMPOSER_MENU_SELECT_ID,
  COMPOSER_MORE_BUTTON_ID,
  COMPOSER_SCROLL_ID,
  COMPOSER_TEXTAREA_ID,
} from "./composer.constants";
import type { ComposerMenuRenderer } from "./composer.types";
import { readComposerPanelText } from "./composer.view";
import { useAmendSelection } from "./useAmendSelection";
import { useComposerCommands } from "./useComposerCommands";
import { useComposerControls } from "./useComposerControls";
import { useComposerMessageAttempt } from "./useComposerMessageAttempt";

// The shell imports the textarea id from this module, so keep that single re-export while every
// other constant and helper is imported from its owning module.
export { COMPOSER_TEXTAREA_ID } from "./composer.constants";

/**
 * Owns the composer state, enablement, menu session, amend load, and command dispatch.
 *
 * The draft lives only in `DraftProvider`: this hook reads and writes it through `useDraft` and keeps
 * no second copy. The hook registers exactly the composer-scoped actions in the `right-pane` scope:
 * the four commit variants, `commit.options`, `form.submit`, and the composer's own `nav.left`,
 * `nav.right`, and `nav.activate`. It never registers `commit.focus`, `app.quit`, `focus.*`, or
 * `app.refresh`.
 *
 * This hook is the composition point. `useAmendSelection` owns the menu session and previous-message
 * load, `useComposerCommands` owns dispatch and the options overlay, and `useComposerControls` owns
 * the focused control. The hook publishes its enablement so the footer reads the same result the
 * panel renders. It also owns the message-required attempt flag: the composer shows that error only
 * after a commit was triggered with an empty draft, and any draft edit clears the flag so the error
 * does not linger while the user fixes the message.
 *
 * @param options - The JSX renderer for the commit options overlay.
 * @returns Composer view state plus the handlers the panel renders.
 */
export function useComposer(options: { readonly renderOptionsMenu: ComposerMenuRenderer }) {
  const repository = useRepository();
  const { draft, setDraft, clearDraft } = useDraft();
  const region = useFocusRegion("right-pane");
  const draftRef = useRef(draft);
  const messageAttempt = useComposerMessageAttempt();

  draftRef.current = draft;

  /**
   * Writes the draft through the single owner and keeps the dispatch-time mirror current.
   *
   * Any edit clears the message-required attempt, so the inline error does not linger while the
   * user fixes the message.
   *
   * @param value - New draft text.
   */
  const writeDraft = useCallback(
    (value: string): void => {
      draftRef.current = value;
      messageAttempt.clearAttempt();
      setDraft(value);
    },
    [messageAttempt, setDraft],
  );

  const amend = useAmendSelection({
    client: repository.gitClient,
    cwd: repository.signals.repositoryRoot ?? repository.signals.cwd,
    readDraft: () => draftRef.current,
    writeDraft,
  });
  const commands = useComposerCommands({
    draftRef,
    repository,
    renderOptionsMenu: options.renderOptionsMenu,
    clearDraft,
    onMessageRequired: messageAttempt.markAttempted,
    amend,
  });
  const controls = useComposerControls({
    openOptions: commands.openOptions,
    submit: commands.submit,
    committing: commands.committing,
  });
  const stagedCount = selectPendingCounts(repository.snapshot).staged;
  const identity = repository.signals.identity;
  const enablement = readComposerCommandState({
    draft,
    stagedCount,
    identity,
    headExists: repository.signals.headExists,
    amend: false,
    committing: commands.committing,
  });
  const amendEnablement = readComposerCommandState({
    draft,
    stagedCount,
    identity,
    headExists: repository.signals.headExists,
    amend: true,
    committing: commands.committing,
  });

  const panelText = readComposerPanelText({
    reason: enablement.reason,
    available: enablement.available,
    messageAttempted: messageAttempt.attempted,
  });

  useEffect(() => {
    const cleanups = [
      publishActionAvailability("right-pane", "commit.submit", enablement.available),
      publishActionAvailability("right-pane", "commit.submitNoVerify", enablement.available),
      publishActionAvailability("right-pane", "commit.amend", amendEnablement.available),
      publishActionAvailability("right-pane", "commit.amendNoVerify", amendEnablement.available),
      publishActionAvailability("right-pane", "commit.options", commands.committing === false),
      publishActionAvailability("right-pane", "form.submit", enablement.available),
    ];

    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }, [amendEnablement.available, commands.committing, enablement.available]);

  return {
    regionProps: region.regionProps,
    regionFocused: region.focused,
    focusRegion: region.focus,
    draft,
    setDraft: writeDraft,
    focusedControl: controls.focusedControl,
    commitLabel: panelText.commitLabel,
    primaryReason: enablement.reason,
    blockedReason: panelText.blockedReason,
    messageError: panelText.messageError,
    committing: commands.committing,
    identity,
    missingIdentity: readMissingIdentity(identity),
    stagedCount,
    amendShortHash: amend.amendShortHash,
    activateFocusedControl: controls.activateFocusedControl,
    moveControl: controls.moveControl,
    openOptions: commands.openOptions,
    runVariant: commands.runVariant,
    highlightVariant: amend.highlightVariant,
    dismissMenu: commands.dismissMenu,
    textareaId: COMPOSER_TEXTAREA_ID,
    moreButtonId: COMPOSER_MORE_BUTTON_ID,
    commitButtonId: COMPOSER_COMMIT_BUTTON_ID,
    scrollId: COMPOSER_SCROLL_ID,
    menuSelectId: COMPOSER_MENU_SELECT_ID,
  };
}
