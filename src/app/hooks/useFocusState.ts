import { useContext } from "react";
import { FocusContext } from "@/app/providers/FocusProvider";
import type { FocusContextValue } from "@/features/shell/focus.types";

/**
 * Reads the derived focus projection and cursor helpers.
 *
 * @returns The focus context value.
 * @throws When called outside a `FocusProvider`.
 */
export function useFocusState(): FocusContextValue {
  const value = useContext(FocusContext);

  if (!value) {
    throw new Error("useFocusState must be used within a FocusProvider.");
  }

  return value;
}
