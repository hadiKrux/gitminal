import { createContext, type ReactNode } from "react";
import { useOverlaySurfaceState } from "@/app/hooks/useOverlaySurfaceState";
import type {
  OverlayContextValue,
  OverlayProviderProps,
} from "@/app/providers/OverlayProvider.types";

/** Context carrying the single overlay entry, the error detail, and their focus capture. */
export const OverlayContext = createContext<OverlayContextValue | null>(null);

/**
 * Owns the single overlay entry, the persistent error detail, and the focus captured when either
 * surface opened.
 *
 * The provider sits below `FocusProvider` so it can read the renderer's current focus and restore it
 * through `restoreFocus`; it sits above `StatusProvider`, so it never reads or writes status. Only
 * one entry exists at a time: opening a second entry replaces the first, and the focus captured by
 * the original open is kept, because the user's background context never changed. A new error
 * replaces the visible error detail rather than stacking, and the error detail is a separate field,
 * so an error never silently replaces an open modal.
 *
 * It renders no UI; `OverlayHost` projects the entry and the error detail. The state transitions live
 * in `OverlayProvider.state.ts` and the effectful surface operations in `useOverlaySurfaceState`.
 *
 * @param props - Provider content.
 * @returns The overlay context provider.
 */
export function OverlayProvider(props: OverlayProviderProps): ReactNode {
  const value = useOverlaySurfaceState();

  return <OverlayContext.Provider value={value}>{props.children}</OverlayContext.Provider>;
}
