import { useContext } from "react";
import { StatusContext } from "@/app/providers/StatusProvider";
import type { StatusContextValue } from "@/app/providers/StatusProvider.types";

/**
 * Reads transient status, operation progress, and the footer hint mode.
 *
 * @returns The status context value.
 * @throws When called outside a `StatusProvider`.
 */
export function useStatus(): StatusContextValue {
  const value = useContext(StatusContext);

  if (!value) {
    throw new Error("useStatus must be used within a StatusProvider.");
  }

  return value;
}
