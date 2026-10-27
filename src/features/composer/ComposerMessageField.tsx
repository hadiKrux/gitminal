import type { TextareaRenderable } from "@opentui/core";
import type { ReactNode, RefObject } from "react";
import { COMPOSER_PLACEHOLDER } from "@/features/composer/composer.constants";
import { useTokens } from "@/theme/useTokens";

/**
 * Renders the composer's multiline message field and its bounded scroll region.
 *
 * The field is a `<textarea>` so Enter inserts a newline and the draft keeps its lines. It grows to
 * the rows the composer measured for it; once the draft has more lines than that, the field is
 * wrapped in a `<scrollbox>` of the same height so the scrollbar marks the overflow. A disabled
 * field keeps its normal background and dims its text, because it still shows the last draft.
 *
 * @param props - Renderable ids, field ref, draft, rows, scroll flag, and the draft writer.
 * @returns The message field, optionally inside a scroll region.
 */
export function ComposerMessageField(props: {
  readonly textareaId: string;
  readonly scrollId: string;
  readonly fieldRef: RefObject<TextareaRenderable | null>;
  readonly draft: string;
  readonly rows: number;
  readonly scrolls: boolean;
  readonly disabled: boolean;
  readonly onDraftChange: (value: string) => void;
}): ReactNode {
  const tokens = useTokens();
  const field = (
    <textarea
      id={props.textareaId}
      ref={props.fieldRef}
      height={props.rows}
      initialValue={props.draft}
      placeholder={COMPOSER_PLACEHOLDER}
      backgroundColor={tokens.surface}
      focusedBackgroundColor={tokens.surface}
      textColor={props.disabled ? tokens.dim : tokens.text}
      focusedTextColor={tokens.text}
      placeholderColor={tokens.dim}
      wrapMode="word"
      onContentChange={() => {
        props.onDraftChange(props.fieldRef.current?.plainText ?? "");
      }}
    />
  );

  if (!props.scrolls) {
    return field;
  }

  return (
    <scrollbox
      id={props.scrollId}
      height={props.rows}
      focusable={false}
      scrollbarOptions={{ trackOptions: { foregroundColor: tokens.scrollbar } }}
    >
      {field}
    </scrollbox>
  );
}
