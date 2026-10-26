import type { InputProps } from "@opentui/react";
import type { ReactNode } from "react";
import { useTokens } from "@/theme/useTokens";

/**
 * Renders a controlled single-line search field.
 *
 * The field is a native `<input>` with a stable id so the owning feature can focus it through
 * `FocusProvider.focusRenderable`. Its value is fully controlled: the caller stores the string and
 * passes it back from `onInput`, which keeps a filter clear or restore deterministic. `onSubmit` is
 * optional and fires on the input's native submit. The `surface` background and `text` foreground
 * match the raised-input token targets, and the placeholder uses the `dim` token.
 *
 * @param props - Stable id, current value, placeholder, input handler, and optional submit handler.
 * @returns The composed search field.
 */
export function SearchField(props: {
  readonly id: string;
  readonly value: string;
  readonly placeholder?: string;
  readonly onInput: (value: string) => void;
  readonly onSubmit?: (value: string) => void;
}): ReactNode {
  const tokens = useTokens();
  // `InputRenderable` emits the current value on submit, but the catalogue types the prop as the
  // textarea event signature intersected with the value signature. The caller API stays value-based,
  // so the single boundary cast below is the only place the catalogue type is bridged.
  const onSubmit = props.onSubmit as unknown as InputProps["onSubmit"];

  return (
    <box flexDirection="row" flexShrink={0} height={1}>
      <input
        id={props.id}
        value={props.value}
        placeholder={props.placeholder ?? ""}
        onInput={props.onInput}
        onSubmit={onSubmit}
        flexGrow={1}
        backgroundColor={tokens.surface}
        focusedBackgroundColor={tokens.surface}
        textColor={tokens.text}
        focusedTextColor={tokens.text}
        placeholderColor={tokens.dim}
      />
    </box>
  );
}
