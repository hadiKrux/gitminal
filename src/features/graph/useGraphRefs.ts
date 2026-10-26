import type { ScrollBoxRenderable } from "@opentui/core";
import { useRef } from "react";
import type { RepositorySelection } from "@/domain/repository/repository.types";

/**
 * Owns the graph's scroll, selection-memory, and search-delegate refs.
 *
 * Keeping the refs together lets `useCommitGraph` stay a flat composition of its feature hooks while
 * the paging, selection, and search hooks still receive the exact ref objects they need.
 *
 * @param selection - Current right-pane selection.
 * @returns The scroll ref, the selection memory refs, and the search delegate holder.
 */
export function useGraphRefs(selection: RepositorySelection) {
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const selectionRef = useRef(selection);
  const lastSelectionIndexRef = useRef(0);
  const searchDelegateActionRef = useRef<
    (action: "up" | "down" | "first" | "last" | "activate") => boolean
  >(() => false);

  return { scrollRef, selectionRef, lastSelectionIndexRef, searchDelegateActionRef };
}
