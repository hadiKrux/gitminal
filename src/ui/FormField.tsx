import type { InputProps } from "@opentui/react";
import type { ReactNode } from "react";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";

/**
 * Renders a labeled form field with inline validation text.
 *
 * The label sits above the editor. When the caller supplies children, they replace the built-in
 * single-line `<input>`, which is how a multiline `<textarea>` field is composed. The error line is
 * prefixed with the `ICONS.error` marker so the failure is not conveyed by color alone.
 *
 * @param props - Label, optional input value and handlers, optional child editor, and error text.
 * @returns The composed form field.
 */
export function FormField(props: {
  readonly label: string;
  readonly id?: string;
  readonly value?: string;
  readonly placeholder?: string;
  readonly onInput?: (value: string) => void;
  readonly onSubmit?: (value: string) => void;
  readonly error?: string;
  readonly children?: ReactNode;
}): ReactNode {
  const tokens = useTokens();
  const error = props.error ?? "";
  // `InputRenderable` emits the current value on submit, but the catalogue types the prop as the
  // textarea event signature intersected with the value signature. The caller API stays value-based,
  // so the single boundary cast below is the only place the catalogue type is bridged.
  const onSubmit = props.onSubmit as unknown as InputProps["onSubmit"];

  return (
    <box flexDirection="column" flexShrink={0}>
      <text fg={tokens.muted} wrapMode="none">
        {props.label}
      </text>
      {props.children === undefined ? (
        <input
          id={props.id}
          value={props.value ?? ""}
          placeholder={props.placeholder ?? ""}
          onInput={props.onInput}
          onSubmit={onSubmit}
          backgroundColor={tokens.surface}
          focusedBackgroundColor={tokens.surface}
          textColor={tokens.text}
          focusedTextColor={tokens.text}
          placeholderColor={tokens.dim}
        />
      ) : (
        props.children
      )}
      {error.length === 0 ? null : (
        <text fg={tokens.error} wrapMode="word">
          {`${ICONS.error} ${error}`}
        </text>
      )}
    </box>
  );
}
