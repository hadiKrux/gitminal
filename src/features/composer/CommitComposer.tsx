import type { BoxRenderable, TextareaRenderable } from "@opentui/core";
import { usePaste } from "@opentui/react";
import { type ReactNode, useEffect, useRef } from "react";
import { useBoxRows } from "@/app/hooks/useBoxRows";
import { useFocusState } from "@/app/hooks/useFocusState";
import { CommitOptionsMenu } from "@/features/composer/CommitOptionsMenu";
import { ComposerIdentity } from "@/features/composer/ComposerIdentity";
import { readComposerRowCap, readComposerVisibleRows } from "@/features/composer/composer.commands";
import { COMPOSER_COMMITTING_LABEL } from "@/features/composer/composer.constants";
import { readComposerView } from "@/features/composer/composer.view";
import { useComposer } from "@/features/composer/useComposer";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import { Button } from "@/ui/Button";
import { FormField } from "@/ui/FormField";
import { Panel } from "@/ui/Panel";
import { Spinner } from "@/ui/Spinner";

/**
 * Renders the commit composer as the right-pane surface.
 *
 * The component owns the `right-pane` region frame and its own Panel titled "Commit". It renders the
 * staged count, the amend indicator, the read-only identity line, the multiline message field with
 * the "Commit message..." placeholder, the icon-only More button, the Commit button, and the
 * committing spinner. The textarea grows to the rows the right-pane slot actually leaves and then
 * scrolls inside a bounded `<scrollbox>`. The panel fills the wrapper `MainArea` gives it instead of
 * enforcing its own minimum, so a short terminal shrinks the message field, down to one row in the
 * slot the console drawer leaves at 80x24, rather than pushing the More and Commit controls out of
 * the panel or over the diff.
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
  const tokens = useTokens();
  const { state } = useFocusState();
  const fieldRef = useRef<TextareaRenderable | null>(null);
  const contentRef = useRef<BoxRenderable | null>(null);
  const { rows: contentRows, onSizeChange: onContentResize } = useBoxRows(contentRef);
  const rowCap = readComposerRowCap(contentRows);
  const visibleRows = readComposerVisibleRows(composer.draft, rowCap);
  const scrolls = composer.draft.split("\n").length > visibleRows;
  const view = readComposerView({
    committing: composer.committing,
    stagedCount: composer.stagedCount,
    amendShortHash: composer.amendShortHash,
    primaryReason: composer.primaryReason,
    blockedReason: composer.blockedReason,
  });

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

  const messageField = (
    <textarea
      id={composer.textareaId}
      ref={fieldRef}
      height={visibleRows}
      initialValue={composer.draft}
      placeholder="Commit message..."
      backgroundColor={tokens.surface}
      focusedBackgroundColor={tokens.surface}
      textColor={view.textareaDisabled ? tokens.dim : tokens.text}
      focusedTextColor={tokens.text}
      placeholderColor={tokens.dim}
      wrapMode="word"
      onContentChange={() => {
        composer.setDraft(fieldRef.current?.plainText ?? "");
      }}
    />
  );

  return (
    <Panel
      {...composer.regionProps}
      focused={composer.regionFocused}
      title="Commit"
      flexGrow={1}
      flexBasis={0}
      overflow="hidden"
    >
      <box ref={contentRef} onSizeChange={onContentResize} flexDirection="column" flexGrow={1}>
        <box flexDirection="row" flexShrink={0} gap={2}>
          <text fg={tokens.muted} wrapMode="none">
            {`${composer.stagedCount} staged`}
          </text>
          {composer.amendShortHash === null ? null : (
            <text fg={tokens.accent} wrapMode="none">
              {`Amending ${composer.amendShortHash}`}
            </text>
          )}
        </box>
        <ComposerIdentity identity={composer.identity} />
        <FormField label="Message" error={composer.messageError ?? undefined}>
          {scrolls ? (
            <scrollbox
              id={composer.scrollId}
              height={visibleRows}
              focusable={false}
              scrollbarOptions={{ trackOptions: { foregroundColor: tokens.scrollbar } }}
            >
              {messageField}
            </scrollbox>
          ) : (
            messageField
          )}
        </FormField>
        <box flexDirection="row" flexShrink={0} gap={1} alignItems="center">
          <Button
            id={composer.moreButtonId}
            label="More"
            icon={ICONS.ellipsis}
            iconOnly
            focused={composer.focusedControl === "more"}
            disabled={composer.committing}
            onPress={composer.openOptions}
          />
          <Button
            id={composer.commitButtonId}
            label={composer.commitLabel}
            focused={composer.focusedControl === "commit"}
            disabled={view.commitDisabled}
            reason={view.commitReason}
            onPress={() => {
              composer.runVariant("commit.submit");
            }}
          />
          {composer.committing ? (
            <box flexDirection="row" flexShrink={0} gap={1}>
              <Spinner />
              <text fg={tokens.accent} wrapMode="none">
                {COMPOSER_COMMITTING_LABEL}
              </text>
            </box>
          ) : null}
        </box>
        {view.showStateText ? (
          <text fg={tokens.warning} wrapMode="none">
            {`${ICONS.warning} ${composer.blockedReason}`}
          </text>
        ) : null}
      </box>
    </Panel>
  );
}
