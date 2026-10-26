import { createContext, type ReactNode, useCallback, useMemo, useState } from "react";
import type { DraftContextValue, DraftProviderProps } from "@/app/providers/DraftProvider.types";

/**
 * Context carrying the composer draft and the quit-confirmation read.
 *
 * The provider is the single owner of the draft string. The composer writes it; the shell quit
 * handler reads `hasUnsavedDraft`; no feature imports another feature to answer the unsaved-work
 * question. A failure path never calls `clearDraft`, so a failed commit preserves the message, and
 * only a successful commit or amend clears it.
 */
export const DraftContext = createContext<DraftContextValue | null>(null);

/**
 * Provides the composer draft to the app.
 *
 * @param props - Initial draft and provider content.
 * @returns The draft context provider.
 */
export function DraftProvider(props: DraftProviderProps): ReactNode {
  const [draft, setDraftState] = useState<string>(props.initialDraft ?? "");

  /** Replaces the draft with the given text. */
  const setDraft = useCallback((next: string): void => {
    setDraftState(next);
  }, []);

  /** Clears the draft after a successful commit or amend. */
  const clearDraft = useCallback((): void => {
    setDraftState("");
  }, []);

  const value = useMemo<DraftContextValue>(
    () => ({ draft, hasUnsavedDraft: draft.trim().length > 0, setDraft, clearDraft }),
    [clearDraft, draft, setDraft],
  );

  return <DraftContext.Provider value={value}>{props.children}</DraftContext.Provider>;
}
