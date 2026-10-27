import { type MutableRefObject, useRef } from "react";
import { useAction } from "@/app/hooks/useAction";
import { useCommandRunner } from "@/app/hooks/useCommandRunner";
import { useOverlay } from "@/app/hooks/useOverlay";
import type { useRepository } from "@/app/hooks/useRepository";
import { useStatus } from "@/app/hooks/useStatus";
import { COMMIT_FORM_MESSAGE } from "@/domain/commands/commands.commit";
import { describeCommandReason } from "@/domain/commands/commands.reasons";
import type { CommandAvailabilityReason } from "@/domain/commands/commands.types";
import { selectPendingCounts } from "@/domain/repository/repository.selectors";
import {
  COMMIT_VARIANTS,
  describeCommitVariantReason,
  readComposerCommandState,
} from "./composer.commands";
import { COMMIT_OPTIONS_ACTION_ID, COMPOSER_MENU_OVERLAY_ID } from "./composer.constants";
import type { ComposerMenuRenderer } from "./composer.types";

/**
 * Owns the composer's commit dispatch, amend-aware live checks, and options menu.
 *
 * Every commit variant goes through the single command runner. The message is read from the live
 * draft at dispatch time, never from a captured render value, so a menu action runs exactly what the
 * textarea shows. An attempt while the only missing piece is the message reports through
 * `onMessageRequired` instead of the shared status line, so the composer can show its inline error.
 * Success clears the draft and any amend indicator; a blocked, failed, cancelled, or timed-out
 * result leaves both untouched. The options menu reads the same shared availability rule the footer
 * and palette use and reports the highlighted row, Run, and Cancel back through callbacks.
 *
 * @param input - Live draft ref, repository value, menu renderer, draft clear, amend session, and
 * the message-required attempt callback.
 * @returns The dispatch and menu entry points plus the committing flag.
 */
export function useComposerCommands(input: {
  readonly draftRef: MutableRefObject<string>;
  readonly repository: ReturnType<typeof useRepository>;
  readonly renderOptionsMenu: ComposerMenuRenderer;
  readonly clearDraft: () => void;
  readonly onMessageRequired: () => void;
  readonly amend: {
    readonly beginSession: (snapshot: string) => void;
    readonly closeSession: (restore: boolean, keepAmendIndicator?: boolean) => void;
    readonly highlightVariant: (commandId: string) => void;
    readonly clearAmendIndicator: () => void;
    readonly ensureAmendReady: (draft: string) => Promise<boolean>;
  };
}) {
  const { amend, clearDraft, draftRef, onMessageRequired, renderOptionsMenu, repository } = input;
  const { operation, setStatus } = useStatus();
  const overlay = useOverlay();
  const { runCommand } = useCommandRunner();
  const committing = operation !== null;
  const runPendingRef = useRef(false);

  /**
   * Reads one variant's live availability from the current draft and repository state.
   *
   * @param amendVariant - True for the amend variants.
   * @returns The shared availability result.
   */
  function readLiveState(amendVariant: boolean) {
    return readComposerCommandState({
      draft: draftRef.current,
      stagedCount: selectPendingCounts(repository.snapshot).staged,
      identity: repository.signals.identity,
      headExists: repository.signals.headExists,
      amend: amendVariant,
      committing: operation !== null,
    });
  }

  /** Reports the shared blocked reason for an unavailable variant. */
  function reportBlocked(reason: CommandAvailabilityReason | null): void {
    setStatus({
      kind: "warning",
      message: describeCommandReason(reason ?? "operation-in-progress"),
    });
  }

  /**
   * Prepares and dispatches one commit variant through the single command runner.
   *
   * An amend variant first ensures a session exists and HEAD is loaded, then applies the previous
   * message when the draft is empty and sets the indicator before the write starts. The same path
   * serves the menu Run button, a direct action id, and a palette dispatch, so none of them can
   * amend without naming the commit or sending an empty message.
   *
   * @param commandId - One of the four commit command ids.
   * @param fromMenu - True when the options menu started the variant.
   */
  async function dispatch(commandId: string, fromMenu: boolean): Promise<void> {
    const variant = COMMIT_VARIANTS.find((candidate) => candidate.commandId === commandId);

    if (variant === undefined) {
      return;
    }

    if (!(await prepareVariant(variant, fromMenu))) {
      runPendingRef.current = false;

      return;
    }

    const liveState = readLiveState(variant.amend);

    if (!liveState.available) {
      if (liveState.reason === "message-required") {
        // The composer owns this feedback: it shows the message error inline after the attempt.
        onMessageRequired();

        return;
      }

      reportBlocked(liveState.reason);

      return;
    }

    const result = await runCommand({
      commandId,
      target: { kind: "none" },
      formValues: { [COMMIT_FORM_MESSAGE]: draftRef.current },
    });

    if (result.status === "success" && result.cancelled !== true && result.timedOut !== true) {
      amend.clearAmendIndicator();
      draftRef.current = "";
      clearDraft();
    }
  }

  /**
   * Prepares an amend load and closes the session before the write starts.
   *
   * A normal variant only closes the menu session. An amend variant refuses an empty repository,
   * awaits the previous-message load, applies it to an empty draft, and keeps the indicator for the
   * write. A real load failure closes the session without starting a write.
   *
   * @param variant - Variant being dispatched.
   * @param fromMenu - True when the options menu started the variant.
   * @returns True when the caller may dispatch the command.
   */
  async function prepareVariant(
    variant: (typeof COMMIT_VARIANTS)[number],
    fromMenu: boolean,
  ): Promise<boolean> {
    if (variant.amend) {
      if (!repository.signals.headExists) {
        reportBlocked("no-commits-yet");

        return false;
      }

      const ready = await amend.ensureAmendReady(draftRef.current);

      if (!ready) {
        runPendingRef.current = false;
        amend.closeSession(false, false);

        return false;
      }

      amend.closeSession(false, true);
    } else if (fromMenu) {
      amend.closeSession(false, false);
    }

    runPendingRef.current = false;

    return true;
  }

  /**
   * Dispatches one commit variant without an owning menu.
   *
   * @param commandId - One of the four commit command ids.
   */
  function submit(commandId: string): void {
    void dispatch(commandId, false).catch(() => {
      // The orchestrator already stored the failure detail; the draft stays for a retry.
    });
  }

  /**
   * Runs one menu variant.
   *
   * An amend variant holds the session open while its load settles, so the overlay's unmount
   * cleanup cannot restore the pre-menu draft and cancel the read that Run needs. A normal variant
   * closes the session immediately.
   *
   * @param commandId - Selected variant command id.
   */
  function runVariant(commandId: string): void {
    const variant = COMMIT_VARIANTS.find((candidate) => candidate.commandId === commandId);

    if (variant === undefined) {
      return;
    }

    if (variant.amend) {
      runPendingRef.current = true;
    }

    void dispatch(commandId, true).catch(() => {
      runPendingRef.current = false;
    });
  }

  /**
   * Ends the menu session and restores the pre-menu draft on an external close.
   *
   * While an amend run is preparing, the unmount cleanup is ignored so the read can finish.
   */
  function dismissMenu(): void {
    if (runPendingRef.current) {
      return;
    }

    amend.closeSession(true);
  }

  /** Cancels the menu, restoring the pre-menu draft. */
  function cancelMenu(): void {
    amend.closeSession(true);
  }

  /** Opens the commit options menu with a snapshot of the current draft. */
  function openOptions(): void {
    if (operation !== null) {
      return;
    }

    amend.beginSession(draftRef.current);

    const variants = COMMIT_VARIANTS.map((variant) => {
      const variantState = readLiveState(variant.amend);

      return {
        commandId: variant.commandId,
        label: variant.label,
        description: variant.description,
        available: variantState.available,
        reason: describeCommitVariantReason(variantState.reason, variant.amend),
      };
    });

    overlay.open({
      kind: "modal",
      id: COMPOSER_MENU_OVERLAY_ID,
      toggleActionId: COMMIT_OPTIONS_ACTION_ID,
      render: ({ close }) =>
        renderOptionsMenu({
          variants,
          onHighlight: amend.highlightVariant,
          onRun: (commandId) => {
            runVariant(commandId);
            close();
          },
          onCancel: () => {
            cancelMenu();
            close();
          },
          onDismiss: dismissMenu,
        }),
    });
  }

  useAction("commit.submit", { scope: "right-pane", targetKind: "none" }, () => {
    submit("commit.submit");
  });
  useAction("commit.submitNoVerify", { scope: "right-pane", targetKind: "none" }, () => {
    submit("commit.submitNoVerify");
  });
  useAction("commit.amend", { scope: "right-pane", targetKind: "none" }, () => {
    submit("commit.amend");
  });
  useAction("commit.amendNoVerify", { scope: "right-pane", targetKind: "none" }, () => {
    submit("commit.amendNoVerify");
  });
  useAction("commit.options", { scope: "right-pane", targetKind: "none" }, openOptions);
  useAction("form.submit", { scope: "right-pane", targetKind: "none" }, () => {
    submit("commit.submit");
  });

  return { submit, runVariant, openOptions, dismissMenu, cancelMenu, committing };
}
