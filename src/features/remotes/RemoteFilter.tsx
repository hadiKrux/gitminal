import type { ReactNode } from "react";
import {
  REMOTES_FILTER_INPUT_ID,
  REMOTES_FILTER_PLACEHOLDER,
} from "@/features/remotes/RemoteFilter.constants";
import { SearchField } from "@/ui/SearchField";

/**
 * Renders the controlled filter field of the remotes panel.
 *
 * The value is owned by `useRemotes`, so typing only lifts the string and every row is derived from
 * it. Printable keys, Backspace, and Delete stay in the native input: the feature never inspects a
 * key event. While the value is non-empty, `useRemotes` registers a first-Esc clear for this field
 * through `registerInputEscapeClear`, so the first Esc clears and keeps focus and the next returns
 * to the remotes region frame.
 *
 * @param props - Current filter value and the value change callback.
 * @returns The composed filter field.
 */
export function RemoteFilter(props: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}): ReactNode {
  return (
    <SearchField
      id={REMOTES_FILTER_INPUT_ID}
      value={props.value}
      placeholder={REMOTES_FILTER_PLACEHOLDER}
      onInput={props.onChange}
    />
  );
}
