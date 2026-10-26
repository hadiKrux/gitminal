import { useContext } from "react";
import { DraftContext } from "@/app/providers/DraftProvider";
import type { DraftContextValue } from "@/app/providers/DraftProvider.types";

/**
 * Reads the composer draft and its unsaved-work flag.
 *
 * The composer writes through `setDraft` and `clearDraft`; the shell quit handler reads
 * `hasUnsavedDraft` from the same provider, so the two can never disagree.
 *
 * @returns The draft context value.
 * @throws When called outside a `DraftProvider`.
 */
export function useDraft(): DraftContextValue {
  const value = useContext(DraftContext);

  if (!value) {
    throw new Error("useDraft must be used within a DraftProvider.");
  }

  return value;
}
