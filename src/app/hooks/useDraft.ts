import { useContext } from "react";
import { DraftContext } from "@/app/providers/DraftProvider";
import type { DraftContextValue } from "@/app/providers/DraftProvider.types";

/**
 * Reads the composer draft and its unsaved-work flag.
 *
 * The composer writes through `setDraft` and `clearDraft` and is the only reader today; once
 * draft-based quit lands the shell quit handler will read `hasUnsavedDraft` from the same provider,
 * so the two can never disagree.
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
