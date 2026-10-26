import { useEffect, useState } from "react";
import { registerInputEscapeClear } from "@/app/hooks/useInputEscapeClear";
import { REMOTES_FILTER_INPUT_ID } from "@/features/remotes/RemoteFilter.constants";

/**
 * Owns the Remotes filter and its first-Esc clear.
 *
 * While the filter is non-empty the hook registers a first-Esc clear for the field, so the first Esc
 * clears and keeps focus and the second returns to the region frame. An empty filter registers
 * nothing.
 *
 * @returns The filter value and its writer.
 */
export function useRemoteFilter() {
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (filter.length === 0) {
      return;
    }

    return registerInputEscapeClear(REMOTES_FILTER_INPUT_ID, () => {
      setFilter("");
    });
  }, [filter.length]);

  return { filter, setFilter };
}
