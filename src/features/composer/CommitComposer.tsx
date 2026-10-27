import type { BoxRenderable, TextareaRenderable } from "@opentui/core";
import { usePaste } from "@opentui/react";
import { type ReactNode, useEffect, useRef } from "react";
import { useBoxSize } from "@/app/hooks/useBoxSize";
import { useFocusState } from "@/app/hooks/useFocusState";
import { CommitOptionsMenu } from "@/features/composer/CommitOptionsMenu";
import { ComposerActions } from "@/features/composer/ComposerActions";
import { ComposerMessageField } from "@/features/composer/ComposerMessageField";
import { ComposerMessages } from "@/features/composer/ComposerMessages";
import { ComposerMetaRow } from "@/features/composer/ComposerMetaRow";
import { readComposerFieldRows } from "@/features/composer/composer.commands";
import { COMPOSER_BODY_PADDING } from "@/features/composer/composer.constants";
import { readComposerView } from "@/features/composer/composer.view";
import { useComposer } from "@/features/composer/useComposer";
import { Panel } from "@/ui/Panel";

/**
 * Renders the commit composer as the right-pane surface.
 *
 * The component owns the `right-pane` region frame and its own Panel titled "Commit". It composes the
 * unlabeled message field, the identity and staged meta row, the button row, and the inline reason
 * rows. The message field is the first row of the body; the identity line sits on the left and the
 * staged count on the right of the row directly below it. The inline message error appears only after
 * the user triggers a commit with an empty draft, and editing the draft clears it again. The body
 * pads its content by one cell on each side. The message field takes every row the meta row, the
 * button row, and an inline reason line leave, so the panel has no dead space above or below them,
 * and a longer draft scrolls inside a bounded `<scrollbox>`. The panel fills the wrapper `MainArea`
 * gives it instead of enforcing its own minimum, so a short terminal shrinks the message field, down
 * to one row in the slot the console drawer leaves at 80x24, rather than pushing the More and Commit
 * controls out of the panel or over the diff.
 *
 * All state and command dispatch live in `useComposer`; this component only renders it. The message
 * field is the single writer of the draft through `DraftProvider`. Enter inserts a newline because
 * the composer never binds it; Tab and Shift+Tab keep their global textarea indent behavior, and
 * `Ctrl/Cmd+S`, `Ctrl/Cmd+Enter`, and `Alt+.` resolve through the shared keymap.
 *
 * @returns The composer panel.
 */
export function CommitComposer(): ReactNode {
  const composer = useComposer({
    renderOptionsMenu: (input) => <CommitOptionsMenu {...input} />,
  });
  const { state } = useFocusState();
  const fieldRef = useRef<TextareaRenderable | null>(null);
  const contentRef = useRef<BoxRenderable | null>(null);
  const { rows, columns, onSizeChange } = useBoxSize(contentRef);
  const view = readComposerView({
    committing: composer.committing,
    stagedCount: composer.stagedCount,
    amendShortHash: composer.amendShortHash,
    primaryReason: composer.primaryReason,
    blockedReason: composer.blockedReason,
  });
  const fieldRows = readComposerFieldRows({
    bodyRows: rows,
    showsReason: composer.messageError !== null || view.showStateText,
  });
  const scrolls = composer.draft.split("\n").length > fieldRows;

  useEffect(() => {
    const field = fieldRef.current;

    if (field === null) {
      return;
    }

    field.focusable = !view.textareaDisabled;
  }, [view.textareaDisabled]);

  useEffect(() => {
    const field = fieldRef.current;

    if (field === null || field.plainText === composer.draft) {
      return;
    }

    field.setText(composer.draft);
  }, [composer.draft]);

  usePaste((event) => {
    if (state.focusedRenderableId !== composer.textareaId) {
      return;
    }

    fieldRef.current?.handlePaste(event);
    event.preventDefault();
  });

  return (
    <Panel
      {...composer.regionProps}
      focused={composer.regionFocused}
      title="Commit"
      flexGrow={1}
      flexBasis={0}
      overflow="hidden"
    >
      <box
        ref={contentRef}
        onSizeChange={onSizeChange}
        paddingLeft={COMPOSER_BODY_PADDING}
        paddingRight={COMPOSER_BODY_PADDING}
        flexDirection="column"
        flexGrow={1}
      >
        <ComposerMessageField
          textareaId={composer.textareaId}
          scrollId={composer.scrollId}
          fieldRef={fieldRef}
          draft={composer.draft}
          rows={fieldRows}
          scrolls={scrolls}
          disabled={view.textareaDisabled}
          onDraftChange={composer.setDraft}
        />
        <ComposerMetaRow
          identity={composer.identity}
          stagedCount={composer.stagedCount}
          amendShortHash={composer.amendShortHash}
          columns={columns}
        />
        <ComposerActions
          moreButtonId={composer.moreButtonId}
          commitButtonId={composer.commitButtonId}
          commitLabel={composer.commitLabel}
          focusedControl={composer.focusedControl}
          committing={composer.committing}
          commitDisabled={view.commitDisabled}
          commitReason={view.commitReason}
          onMore={composer.openOptions}
          onCommit={() => {
            composer.runVariant("commit.submit");
          }}
        />
        <ComposerMessages
          messageError={composer.messageError}
          showStateText={view.showStateText}
          stateText={composer.blockedReason}
        />
      </box>
    </Panel>
  );
}
