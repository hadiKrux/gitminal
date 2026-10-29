import { useRenderer } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import { useAction } from "@/app/hooks/useAction";
import { useFocusState } from "@/app/hooks/useFocusState";
import { useOverlay } from "@/app/hooks/useOverlay";
import { FeatureSearchModal } from "@/features/list-search/FeatureSearchModal";
import { FEATURE_SEARCH_INPUT_ID } from "@/features/list-search/FeatureSearchModal.constants";
import type { FeatureSearchModalProps } from "@/features/list-search/FeatureSearchModal.types";
import { usePanelScroll } from "@/ui/PanelScrollContext";

/**
 * Registers one sidebar's search opener and owns its pending reveal request.
 * No sidebar selection changes while the modal is open, so cancellation needs no rollback.
 * @param region - Owning sidebar scope.
 * @returns Last requested identity (to extend the render cap) and the one-shot reveal request.
 */
export function useFeatureSearch(region: FeatureSearchModalProps["region"]) {
  const overlay = useOverlay();
  const focus = useFocusState();
  const [request, setRequest] = useState<{ readonly id: string } | null>(null);

  useAction("list.filter", { scope: region }, () => {
    overlay.open({
      kind: "modal",
      id: `search-${region}`,
      initialFocusId: FEATURE_SEARCH_INPUT_ID,
      render: ({ close }) => (
        <FeatureSearchModal
          region={region}
          selectedId={focus.getCursor(region)}
          onClose={close}
          onSelect={(id) => setRequest({ id })}
        />
      ),
    });
  });

  return { revealId: request?.id ?? null, request };
}

/**
 * Applies a pending modal reveal to the feature's own cursor, never its activation handler.
 * Each explicit acceptance also scrolls independently of cursor changes, with a cancellable
 * next-frame correction after geometry is published. Ordinary free scrolling schedules no reveal.
 * @param search - Requested identity and its one-shot request identity.
 * @param items - Currently rendered cursor identities, extended to include the requested result.
 * @param select - Feature cursor's identity selector.
 * @param readRowId - Maps a cursor identity to its sidebar renderable id.
 */
export function useFeatureSearchReveal(
  search: ReturnType<typeof useFeatureSearch>,
  items: readonly { readonly id: string }[],
  select: (id: string) => void,
  readRowId: (id: string) => string | null,
): void {
  const renderer = useRenderer();
  const scrollChildIntoView = usePanelScroll()?.scrollChildIntoView;
  const { revealId, request } = search;
  const applied = useRef(request);
  const rowId = revealId === null ? null : readRowId(revealId);

  useEffect(() => {
    if (revealId === null || applied.current === request) {
      return;
    }

    if (items.some((item) => item.id === revealId)) {
      select(revealId);
    }

    applied.current = request;
  }, [items, request, revealId, select]);

  useEffect(() => {
    if (request === null || rowId === null || scrollChildIntoView === undefined) {
      return;
    }

    const childId = rowId;
    const scroll = scrollChildIntoView;
    /** Reveals this explicit acceptance only after the sidebar row has published geometry. */
    function reveal(): void {
      const row = renderer.root.findDescendantById(childId);
      if (row !== undefined && row.height > 0) {
        scroll(childId);
      }
    }

    reveal();
    renderer.once("frame", reveal);
    renderer.requestRender();
    return () => {
      renderer.off("frame", reveal);
    };
  }, [renderer, request, rowId, scrollChildIntoView]);
}
