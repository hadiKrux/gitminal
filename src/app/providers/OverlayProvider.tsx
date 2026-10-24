import { useRenderer } from "@opentui/react";
import { createContext, type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { useFocusState } from "@/app/hooks/useFocusState";
import type {
  OverlayConfirmEntry,
  OverlayConfirmInput,
  OverlayContextValue,
  OverlayEntry,
  OverlayProviderProps,
} from "@/app/providers/OverlayProvider.types";

/** Prefix of the provider-generated confirmation entry id. */
const CONFIRM_ENTRY_ID_PREFIX = "overlay-confirm";

/** Context carrying the single overlay entry and its focus capture. */
export const OverlayContext = createContext<OverlayContextValue | null>(null);

/**
 * Owns the single overlay entry and the focus captured when it opened.
 *
 * The provider sits below `FocusProvider` so it can read the renderer's current focus and restore it
 * through `restoreFocus`; it sits above `StatusProvider`, so it never reads or writes status. Only
 * one entry exists at a time: opening a second entry replaces the first, and the focus captured by
 * the original open is kept, because the user's background context never changed. It renders no UI;
 * `OverlayHost` projects the entry.
 *
 * @param props - Provider content.
 * @returns The overlay context provider.
 */
export function OverlayProvider(props: OverlayProviderProps): ReactNode {
  const renderer = useRenderer();
  const { restoreFocus } = useFocusState();
  const [entry, setEntry] = useState<OverlayEntry | null>(null);
  const entryRef = useRef<OverlayEntry | null>(null);
  const capturedFocusIdRef = useRef<string | null>(null);
  const confirmCounterRef = useRef(0);

  /** Captures the focused renderable id, but only while no entry is open. */
  const captureFocus = useCallback((): void => {
    if (entryRef.current !== null) {
      return;
    }

    capturedFocusIdRef.current = renderer.currentFocusedRenderable?.id ?? null;
  }, [renderer]);

  /** Stores a new entry and notifies consumers. */
  const storeEntry = useCallback((next: OverlayEntry): void => {
    entryRef.current = next;
    setEntry(next);
  }, []);

  /** Replaces the open entry, or opens the first one. */
  const open = useCallback(
    (next: OverlayEntry): void => {
      captureFocus();
      storeEntry(next);
    },
    [captureFocus, storeEntry],
  );

  /** Closes the open entry and restores the captured focus if it is still mounted. */
  const close = useCallback((): void => {
    if (entryRef.current === null) {
      return;
    }

    const capturedFocusId = capturedFocusIdRef.current;

    entryRef.current = null;
    capturedFocusIdRef.current = null;
    setEntry(null);

    if (capturedFocusId !== null) {
      restoreFocus(capturedFocusId);
    }
  }, [restoreFocus]);

  /** Opens a confirmation entry with a generated stable id. */
  const confirm = useCallback(
    (input: OverlayConfirmInput): void => {
      captureFocus();
      confirmCounterRef.current += 1;

      const next: OverlayConfirmEntry = {
        ...input,
        kind: "confirm",
        id: `${CONFIRM_ENTRY_ID_PREFIX}-${confirmCounterRef.current}`,
      };

      storeEntry(next);
    },
    [captureFocus, storeEntry],
  );

  const toggleActionId = readToggleActionId(entry);
  const value = useMemo<OverlayContextValue>(
    () => ({
      entry,
      isOpen: entry !== null,
      toggleActionId,
      open,
      close,
      confirm,
    }),
    [close, confirm, entry, open, toggleActionId],
  );

  return <OverlayContext.Provider value={value}>{props.children}</OverlayContext.Provider>;
}

/**
 * Reads the toggle action id of a modal entry.
 *
 * Confirmations and an empty overlay declare no toggle, so only `overlay.close`, `app.quit`, and a
 * modal's own toggle can resolve while they are open.
 *
 * @param entry - Open entry, or null.
 * @returns The toggle action id, or null.
 */
function readToggleActionId(entry: OverlayEntry | null): string | null {
  if (entry === null || entry.kind !== "modal") {
    return null;
  }

  return entry.toggleActionId ?? null;
}
