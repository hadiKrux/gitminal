import { useCallback } from "react";
import type { RepositoryAvailabilityInput } from "@/app/hooks/useRepositoryAvailability.types";
import type { RepositoryContextValue } from "@/app/providers/RepositoryProvider.types";
import { getAvailability } from "@/domain/commands/commands.availability";
import { isCommandRunning } from "@/domain/commands/commands.runner";
import { detectRepositoryState } from "@/domain/repository/repository.states";

/**
 * Builds the target-aware availability reader from the latest store.
 *
 * The returned function reads the current signals and command latch at call time, so a handler
 * always validates against fresh state without making the provider value change on every read.
 *
 * @param input - Store ref.
 * @returns The availability reader exposed by the provider.
 */
export function useRepositoryAvailability(
  input: RepositoryAvailabilityInput,
): RepositoryContextValue["getAvailability"] {
  return useCallback<RepositoryContextValue["getAvailability"]>(
    (commandId, target, region) =>
      getAvailability(commandId, {
        state: detectRepositoryState(input.storeRef.current.signals),
        signals: input.storeRef.current.signals,
        target,
        region,
        operation: isCommandRunning() ? "running" : "idle",
      }),
    [input.storeRef],
  );
}
