import type { SelectOption } from "@opentui/core";
import { type ReactNode, useCallback, useMemo } from "react";
import { useTokens } from "@/theme/useTokens";

/**
 * Renders a native `<select>` field with mapped options.
 *
 * The wrapper adapts the caller's labelled options to OpenTUI's `SelectOption` shape and reports
 * the selected option's value instead of its index. `onChange` fires when native navigation moves
 * the selection, and `onSelect` fires when the focused option is confirmed. The stable id lets the
 * owning feature focus the control through `FocusProvider`. Its viewport may shrink inside a
 * terminal-clamped modal, keeping subsequent controls visible while native navigation scrolls.
 *
 * @param props - Stable id, options, optional selection and focus state, and change handlers.
 * @returns The composed select field.
 */
export function SelectField(props: {
  readonly id: string;
  readonly options: readonly {
    readonly label: string;
    readonly description?: string;
    readonly value: string;
  }[];
  readonly selectedIndex?: number;
  readonly focused?: boolean;
  readonly height?: number;
  readonly onChange?: (value: string) => void;
  readonly onSelect?: (value: string) => void;
}): ReactNode {
  const tokens = useTokens();
  const options = useMemo<SelectOption[]>(
    () =>
      props.options.map((option) => ({
        name: option.label,
        description: option.description ?? "",
        value: option.value,
      })),
    [props.options],
  );

  const handleChange = useCallback(
    (index: number): void => {
      emitSelectedValue(props.options, index, props.onChange);
    },
    [props.onChange, props.options],
  );

  const handleSelect = useCallback(
    (index: number): void => {
      emitSelectedValue(props.options, index, props.onSelect);
    },
    [props.onSelect, props.options],
  );

  return (
    <select
      id={props.id}
      options={options}
      selectedIndex={props.selectedIndex}
      focused={props.focused}
      height={props.height}
      flexShrink={1}
      backgroundColor={tokens.surface}
      textColor={tokens.text}
      focusedBackgroundColor={tokens.surface}
      focusedTextColor={tokens.text}
      selectedBackgroundColor={tokens.selection}
      selectedTextColor={tokens.text}
      descriptionColor={tokens.dim}
      selectedDescriptionColor={tokens.muted}
      onChange={handleChange}
      onSelect={handleSelect}
    />
  );
}

/**
 * Reports the value of one option index to a caller handler.
 *
 * @param options - Caller-labelled options.
 * @param index - Index reported by the native select.
 * @param handler - Optional caller handler.
 */
function emitSelectedValue(
  options: readonly { readonly value: string }[],
  index: number,
  handler: ((value: string) => void) | undefined,
): void {
  const value = options[index]?.value;

  if (value !== undefined) {
    handler?.(value);
  }
}
