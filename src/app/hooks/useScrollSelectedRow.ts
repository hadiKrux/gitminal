import { useEffect, useRef } from "react";
import { usePanelScroll } from "@/ui/PanelScrollContext";

/**
 * Keeps the active row of a custom-row list inside the panel viewport.
 *
 * The shell renders the single `<scrollbox>` and exposes it through `PanelScrollProvider`, so the
 * panel body only names the active row id and its current position. The effect scrolls when the id
 * changes and when the revision changes for the same id, because inserting rows above the selection
 * moves the row without changing its identity. A repeated id at the same revision is skipped so a
 * re-render for another reason does not fight the user's wheel position. A body outside a panel
 * frame receives no scroll value and the hook does nothing.
 *
 * @param childId - Renderable id of the active row, or `null` when the list is empty.
 * @param revision - Monotonic value that changes when the active row's position can change, normally
 * the active index in the rendered rows.
 */
export function useScrollSelectedRow(childId: string | null, revision: number): void {
  const panelScroll = usePanelScroll();
  const scrollChildIntoView = panelScroll?.scrollChildIntoView;
  const lastScrolledRef = useRef<{ readonly id: string; readonly revision: number } | null>(null);

  useEffect(() => {
    if (childId === null || scrollChildIntoView === undefined) {
      return;
    }

    const lastScrolled = lastScrolledRef.current;

    if (lastScrolled?.id === childId && lastScrolled.revision === revision) {
      return;
    }

    lastScrolledRef.current = { id: childId, revision };
    scrollChildIntoView(childId);
  }, [childId, revision, scrollChildIntoView]);
}
