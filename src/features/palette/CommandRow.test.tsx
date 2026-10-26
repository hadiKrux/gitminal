import { describe, expect, it } from "bun:test";
import { describeCommandReason } from "@/domain/commands/commands.reasons";
import { getCommandDescriptor } from "@/domain/commands/commands.registry";
import type { CommandAvailability, CommandDescriptor } from "@/domain/commands/commands.types";
import {
  buildCommandOption,
  buildGroupOption,
  decodePaletteValue,
  encodePaletteValue,
} from "@/features/palette/CommandRow";
import { PALETTE_UNBOUND_LABEL } from "@/features/palette/CommandRow.constants";
import type { PaletteCommandEntry } from "@/features/palette/CommandRow.types";

/**
 * Builds one captured entry for a catalogue command.
 *
 * @param commandId - Command id present in the registry.
 * @param availability - Availability shown by the entry.
 * @param shortcut - Effective shortcut label.
 * @returns The captured entry.
 */
function entry(
  commandId: string,
  availability: CommandAvailability = { available: true },
  shortcut: string = "x",
): PaletteCommandEntry {
  const descriptor = getCommandDescriptor(commandId) as CommandDescriptor;

  return {
    descriptor,
    target: { kind: "none" },
    availability,
    shortcuts: shortcut === PALETTE_UNBOUND_LABEL ? [] : [shortcut],
    shortcut,
  };
}

describe("buildCommandOption", () => {
  it("prefixes the category and appends the effective shortcut", () => {
    const option = buildCommandOption({
      entry: entry("app.refresh", { available: true }, "r"),
      category: "app",
      textBudget: 120,
    });

    expect(option.name).toBe("App: Refresh (r)");
    expect(option.description).toBe("Reload repository state");
  });

  it("labels an unbound command in the name", () => {
    const option = buildCommandOption({
      entry: entry("focus.region.topBar", { available: true }, PALETTE_UNBOUND_LABEL),
      category: "focus",
      textBudget: 120,
    });

    expect(option.name).toBe(`Focus: Focus top bar (${PALETTE_UNBOUND_LABEL})`);
  });

  it("uses the exact shared reason as the description of a disabled command", () => {
    const option = buildCommandOption({
      entry: entry("branch.delete", { available: false, reason: "missing-target" }, "d"),
      category: "branch",
      textBudget: 120,
    });

    expect(option.description).toBe(describeCommandReason("missing-target"));
  });

  it("carries the command id and target in the option value", () => {
    const target = { kind: "branch", name: "feature" } as const;
    const captured: PaletteCommandEntry = {
      ...entry("branch.checkout", { available: true }, "enter"),
      target,
    };
    const option = buildCommandOption({ entry: captured, category: "branch", textBudget: 120 });

    expect(decodePaletteValue(option.value)).toEqual({
      kind: "command",
      commandId: "branch.checkout",
      target,
    });
  });

  it("truncates a long name and description to the text budget", () => {
    const option = buildCommandOption({
      entry: entry("remote.pushForceOverwrite", { available: true }, "Ctrl+Shift+P"),
      category: "remote",
      textBudget: 20,
    });

    expect(option.name.length).toBeLessThanOrEqual(20);
    expect(option.name).toContain("...");
    expect(option.description.length).toBeLessThanOrEqual(20);
  });
});

describe("buildGroupOption", () => {
  it("renders a non-command header row", () => {
    const option = buildGroupOption("focus", 120);

    expect(option.name).toBe("-- Focus --");
    expect(option.description).toBe("");
    expect(decodePaletteValue(option.value)).toEqual({ kind: "group" });
  });
});

describe("decodePaletteValue", () => {
  it("rejects values that are not palette payloads", () => {
    expect(decodePaletteValue("not json")).toBeNull();
    expect(decodePaletteValue(JSON.stringify({ kind: "command" }))).toBeNull();
    expect(
      decodePaletteValue(
        JSON.stringify({ kind: "command", commandId: "x", target: { kind: "nope" } }),
      ),
    ).toBeNull();
  });

  it("round-trips an encoded command value", () => {
    const value = {
      kind: "command",
      commandId: "diff.stage",
      target: { kind: "diffFile", section: "working", path: "src/a.ts" },
    } as const;

    expect(decodePaletteValue(encodePaletteValue(value))).toEqual(value);
  });
});
