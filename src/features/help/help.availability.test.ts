import { describe, expect, it } from "bun:test";
import type { CommandAvailability, CommandTarget } from "@/domain/commands/commands.types";
import { resolveKeymap } from "@/domain/keymap/keymap.resolve";
import { buildHelpRows } from "@/features/help/help.availability";
import type { HelpAvailabilitySource } from "@/features/help/useHelp.types";

/** Availability stub keyed by command id. */
const UNAVAILABLE: Readonly<Record<string, CommandAvailability>> = Object.freeze({
  "branch.delete": Object.freeze({ available: false, reason: "missing-target" }),
  "commit.focus": Object.freeze({ available: false, reason: "composer-hidden" }),
});

/**
 * Builds an availability source from the stub table.
 *
 * @returns The stub source.
 */
function createAvailabilitySource(): HelpAvailabilitySource {
  return {
    getAvailability(commandId: string): CommandAvailability {
      return UNAVAILABLE[commandId] ?? { available: true };
    },
  };
}

describe("buildHelpRows", () => {
  it("joins every catalogue action with the shared availability reason", () => {
    const rows = buildHelpRows({
      keymap: resolveKeymap({ platform: "linux" }),
      repository: createAvailabilitySource(),
      deriveTarget: (): CommandTarget => ({ kind: "none" }),
      focusContext: null,
      isPendingSelection: false,
    });
    const branchDelete = rows.find((row) => row.actionId === "branch.delete");
    const focusRegion = rows.find((row) => row.actionId === "focus.region.branches");

    expect(rows.length).toBeGreaterThan(0);
    expect(branchDelete?.unavailableReason).toBe("Select an item first");
    expect(branchDelete?.keys).toEqual(["d"]);
    expect(focusRegion?.unavailableReason).toBeNull();
  });

  it("reports the composer reason for commit.focus", () => {
    const rows = buildHelpRows({
      keymap: resolveKeymap({ platform: "linux" }),
      repository: createAvailabilitySource(),
      deriveTarget: (): CommandTarget => ({ kind: "none" }),
      focusContext: "right-pane",
      isPendingSelection: false,
    });
    const commitFocus = rows.find((row) => row.actionId === "commit.focus");

    expect(commitFocus?.sectionId).toBe("composer");
    expect(commitFocus?.unavailableReason).toBe("The commit composer is not visible");
  });

  it("attributes the binding to the focused context and marks unbound actions", () => {
    const rows = buildHelpRows({
      keymap: resolveKeymap({ platform: "linux" }),
      repository: createAvailabilitySource(),
      deriveTarget: (): CommandTarget => ({ kind: "none" }),
      focusContext: "branches",
      isPendingSelection: false,
    });
    const branchCreate = rows.find((row) => row.actionId === "branch.create");
    const topBar = rows.find((row) => row.actionId === "focus.region.topBar");

    expect(branchCreate?.keys).toEqual(["n"]);
    expect(topBar?.keys).toEqual([]);
  });
});
