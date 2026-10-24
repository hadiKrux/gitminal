import { useContext } from "react";
import { ConsoleContext } from "@/app/providers/ConsoleProvider";
import type { ConsoleContextValue } from "@/app/providers/ConsoleProvider.types";

/**
 * Reads the bounded console history and its drawer state.
 *
 * @returns The console context value.
 * @throws When called outside a `ConsoleProvider`.
 */
export function useConsoleLog(): ConsoleContextValue {
  const value = useContext(ConsoleContext);

  if (!value) {
    throw new Error("useConsoleLog must be used within a ConsoleProvider.");
  }

  return value;
}
