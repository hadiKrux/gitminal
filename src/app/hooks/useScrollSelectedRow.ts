import { useEffect, useRef } from "react";
import type { ScrollChildIntoViewTarget } from "@/app/hooks/useScrollSelectedRow.types";
import { usePanelScroll } from "@/ui/PanelScrollContext";

/**
 * Keeps the active row of a custom-row list inside its scroll viewport.
 *
 * The shell renders the single `<scrollbox>` of a sidebar panel and exposes it through
 * `PanelScrollProvider`, so a panel body only names the active row id and its current position. A
 * surface that owns its own scrollbox, such as the diff panel, instead passes that box through
 * `target`, which takes precedence over the panel provider. The effect scrolls when the id changes
 * and when the revision changes for the same id, because inserting rows above the selection moves
 * the row without changing its identity. A repeated id at the same revision is skipped so a
 * re-render for another reason does not fight the user's wheel position. A body with neither a
 * panel provider nor a target scrolls nothing.
 *
 * @param childId - Renderable id of the active row, or `null` when the list is empty.
 * @param revision - Monotonic value that changes when the active row's position can change, normally
 * the active index in the rendered rows.
 * @param target - Scroll surface the caller owns, used instead of the panel provider when present.
 */
export function useScrollSelectedRow(
  childId: string | null,
  revision: number,
  target?: ScrollChildIntoViewTarget,
): void {
  const panelScroll = usePanelScroll();
  const scrollChildIntoView = target?.scrollChildIntoView ?? panelScroll?.scrollChildIntoView;
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
