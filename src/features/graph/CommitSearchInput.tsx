import type { ReactNode } from "react";
import {
  GRAPH_SEARCH_INPUT_ID,
  GRAPH_SEARCH_PLACEHOLDER,
  GRAPH_SEARCH_UNAVAILABLE_MESSAGE,
} from "@/features/graph/graph.constants";
import { useTokens } from "@/theme/useTokens";
import { SearchField } from "@/ui/SearchField";

/**
 * Renders the single-line commit search field.
 *
 * The input keeps a stable id so the search owner can focus it and register its routing mode. When
 * the repository has no commits the field is replaced by a plain disabled message, so search stays
 * visibly unavailable instead of accepting a query that can never match.
 *
 * @param props - Query value, change handler, submit handler, and availability flag.
 * @returns The search field or the unavailable text.
 */
export function CommitSearchInput(props: {
  readonly value: string;
  readonly onInput: (value: string) => void;
  readonly onSubmit: (value: string) => void;
  readonly disabled: boolean;
}): ReactNode {
  const tokens = useTokens();

  if (props.disabled) {
    return (
      <box flexDirection="row" flexShrink={0} height={1} paddingLeft={1}>
        <text fg={tokens.dim} wrapMode="none">
          {GRAPH_SEARCH_UNAVAILABLE_MESSAGE}
        </text>
      </box>
    );
  }

  return (
    <SearchField
      id={GRAPH_SEARCH_INPUT_ID}
      value={props.value}
      placeholder={GRAPH_SEARCH_PLACEHOLDER}
      onInput={props.onInput}
      onSubmit={props.onSubmit}
    />
  );
}
