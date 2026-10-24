import { useFocus } from "@opentui/react";
import { useEffect } from "react";
import type { RepositoryInitialReadInput } from "@/app/hooks/useRepositoryInitialRead.types";

/**
 * Runs the initial repository read and refreshes on terminal-window focus.
 *
 * The initial read runs once per refresh identity. Focus refresh is silent and only runs after a
 * snapshot exists and while the provider is mounted, so it never steals focus or races a read.
 *
 * @param input - Refresh entry point, mount state, and store ref.
 */
export function useRepositoryInitialRead(input: RepositoryInitialReadInput): void {
  const { mountedRef, refresh, storeRef } = input;

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useFocus(() => {
    if (!mountedRef.current || storeRef.current.snapshot === null) {
      return;
    }

    void refresh();
  });
}
