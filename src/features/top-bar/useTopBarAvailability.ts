import { useCallback } from "react";
import { useRepository } from "@/app/hooks/useRepository";
import { useStatus } from "@/app/hooks/useStatus";
import { getCommandDescriptor } from "@/domain/commands/commands.registry";
import type { CommandAvailability } from "@/domain/commands/commands.types";
import type { TopBarAvailabilityReader } from "@/features/top-bar/useTopBar.types";

/**
 * Builds the top bar's branch and target-aware availability reader.
 *
 * The repository reader already includes repository gates, target validation, the domain write
 * latch, and the orchestration slot. This hook adds the status provider's running operation so a
 * mutation stays unavailable during the post-result refresh window that the status strip renders,
 * which is the same window a second orchestration is blocked in.
 *
 * @returns The current branch and the availability reader bound to fresh provider state.
 */
export function useTopBarAvailability(): {
  readonly branch: string;
  readonly getAvailability: TopBarAvailabilityReader;
} {
  const repository = useRepository();
  const { operation } = useStatus();
  const branch = repository.snapshot?.branch ?? repository.signals.branch ?? "";
  const getAvailability = useCallback<TopBarAvailabilityReader>(
    (commandId, target) => {
      const availability = repository.getAvailability(commandId, target, "top-bar");

      if (!availability.available) {
        return availability;
      }

      return readMutationAvailability(commandId, operation !== null, availability);
    },
    [operation, repository],
  );

  return { branch, getAvailability };
}

/**
 * Blocks a mutation when the status strip still renders a running operation.
 *
 * @param commandId - Command id.
 * @param operationRunning - True while `StatusProvider` has an operation.
 * @param availability - Availability computed from the repository reader.
 * @returns The unchanged availability, or a blocked running-operation result.
 */
function readMutationAvailability(
  commandId: string,
  operationRunning: boolean,
  availability: CommandAvailability,
): CommandAvailability {
  if (!operationRunning || getCommandDescriptor(commandId)?.kind !== "mutation") {
    return availability;
  }

  return { available: false, reason: "operation-in-progress" };
}
