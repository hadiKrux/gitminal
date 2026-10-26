import { createContext, type ReactNode, useContext } from "react";
import type { PanelScrollValue } from "@/ui/PanelScrollContext.types";

/** Context carrying one panel frame's scroll access to its body, or `null` outside a frame. */
const PanelScrollContext = createContext<PanelScrollValue | null>(null);

/**
 * Provides the surrounding panel frame's scroll container to every row in the body.
 *
 * @param props - The scroll value and the panel body content.
 * @returns The context provider.
 */
export function PanelScrollProvider(props: {
  readonly value: PanelScrollValue;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <PanelScrollContext.Provider value={props.value}>{props.children}</PanelScrollContext.Provider>
  );
}

/**
 * Reads the scroll access of the surrounding panel frame.
 *
 * Returns `null` outside a `PanelScrollProvider`, so a panel body rendered on its own, such as in a
 * component test or another surface, degrades to no scrolling instead of throwing.
 *
 * @returns The provided scroll value, or `null` when no frame provides one.
 */
export function usePanelScroll(): PanelScrollValue | null {
  return useContext(PanelScrollContext);
}
