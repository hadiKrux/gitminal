import type { ScrollBoxRenderable } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { type ReactNode, useEffect, useRef } from "react";
import { useTokens } from "@/theme/useTokens";
import { ListRow } from "@/ui/ListRow";
import { ModalFrame } from "@/ui/ModalFrame";
import { ScrollableList } from "@/ui/ScrollableList";
import { SearchField } from "@/ui/SearchField";
import {
  FEATURE_SEARCH_DETAILS_ID,
  FEATURE_SEARCH_HINTS_ID,
  FEATURE_SEARCH_INPUT_ID,
  FEATURE_SEARCH_MAX_DETAIL_ROWS,
  FEATURE_SEARCH_MAX_RESULT_ROWS,
  FEATURE_SEARCH_RESULTS_ID,
  FEATURE_SEARCH_SPACER_ROWS,
  FEATURE_SEARCH_WIDTH,
} from "./FeatureSearchModal.constants";
import type { FeatureSearchModalProps } from "./FeatureSearchModal.types";
import { formatFeatureSearchName } from "./featureSearch.rows";
import { useFeatureSearchModal } from "./useFeatureSearchModal";

/**
 * Renders a wide, read-only feature search overlay. Input and wrapping full-name details are
 * non-scrolling siblings of the results, never children of the sidebar's scroll container.
 * The frame fits its content: short details reserve no filler, results use at most twelve rows,
 * and long selected names still wrap. One blank row follows input and one precedes footer hints.
 * Highlight reveal retries after layout and cancels on unmount.
 * Enter reveals the row without checkout or mutation; Escape leaves the sidebar cursor unchanged.
 * @param props - Sidebar ownership and overlay completion boundary.
 * @returns The feature search modal.
 */
export function FeatureSearchModal(props: FeatureSearchModalProps): ReactNode {
  const tokens = useTokens();
  const search = useFeatureSearchModal(props);
  const scroll = useRef<ScrollBoxRenderable | null>(null);
  const renderer = useRenderer();
  const selectedId = search.selected?.id;

  useEffect(() => {
    if (selectedId === undefined) {
      return;
    }

    const rowId = `feature-search-row-${search.index}`;
    /** Reveals the current highlight once its mount or changed-result layout is published. */
    function reveal(): void {
      const box = scroll.current;
      const row = box?.content.findDescendantById(rowId);
      if (box !== null && row !== undefined && row.height > 0) {
        box.scrollChildIntoView(rowId);
      }
    }

    reveal();
    renderer.once("frame", reveal);
    renderer.requestRender();
    return () => {
      renderer.off("frame", reveal);
    };
  }, [renderer, search.index, selectedId]);

  return (
    <ModalFrame title={`Search ${props.region}`} width={FEATURE_SEARCH_WIDTH} gap={0}>
      <SearchField
        id={FEATURE_SEARCH_INPUT_ID}
        value={search.query}
        placeholder={`Search ${props.region}`}
        onInput={search.setQuery}
      />
      <box height={FEATURE_SEARCH_SPACER_ROWS} flexShrink={0} />
      <box
        id={FEATURE_SEARCH_DETAILS_ID}
        maxHeight={FEATURE_SEARCH_MAX_DETAIL_ROWS}
        flexShrink={0}
        flexDirection="column"
        overflow="hidden"
      >
        <text fg={tokens.muted}>Selected item</text>
        <text fg={tokens.text} wrapMode="char">
          {formatFeatureSearchName(search.selected)}
        </text>
        <text fg={tokens.dim} wrapMode="char">
          {search.selected?.details ?? ""}
        </text>
      </box>
      {search.error === null ? null : (
        <text fg={tokens.error} wrapMode="word">{`Read failed: ${search.error}`}</text>
      )}
      <ScrollableList
        id={FEATURE_SEARCH_RESULTS_ID}
        scrollRef={scroll}
        height={Math.max(1, Math.min(FEATURE_SEARCH_MAX_RESULT_ROWS, search.rows.length))}
        flexGrow={0}
        viewportCulling
      >
        {search.loading ? <text fg={tokens.muted}>Loading...</text> : null}
        {!search.loading && search.rows.length === 0 ? (
          <text fg={tokens.muted}>{search.query.trim() ? "No matches" : `No ${props.region}`}</text>
        ) : null}
        {search.rows.map((row, index) => (
          <ListRow
            key={row.id}
            id={`feature-search-row-${index}`}
            selected={row.id === search.selected?.id}
            focused
            onMouseDown={() => search.setHighlight(row.id)}
          >
            <text fg={tokens.text} wrapMode="none">
              {formatFeatureSearchName(row)}
            </text>
          </ListRow>
        ))}
      </ScrollableList>
      <box height={FEATURE_SEARCH_SPACER_ROWS} flexShrink={0} />
      <text id={FEATURE_SEARCH_HINTS_ID} fg={tokens.muted} flexShrink={0}>
        Up/Down Navigate | Enter Reveal in sidebar | Esc Cancel
      </text>
    </ModalFrame>
  );
}
