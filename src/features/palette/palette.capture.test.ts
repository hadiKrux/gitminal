import { describe, expect, it } from "bun:test";
import { listCommandDescriptors } from "@/domain/commands/commands.registry";
import type {
  CommandAvailability,
  CommandRegion,
  CommandTarget,
} from "@/domain/commands/commands.types";
import { parseBinding } from "@/domain/keymap/keymap.parse";
import type { ParsedBinding, ResolvedKeymap } from "@/domain/keymap/keymap.types";
import { PALETTE_UNBOUND_LABEL } from "@/features/palette/CommandRow.constants";
import { capturePaletteEntries } from "@/features/palette/palette.capture";
import type { PaletteAvailabilitySource } from "@/features/palette/palette.targets.types";

/** One availability read the fake repository recorded. */
interface AvailabilityCall {
  /** Command whose availability was read. */
  readonly commandId: string;
  /** Explicit target passed to the read. */
  readonly target: CommandTarget;
  /** Region context passed to the read. */
  readonly region: CommandRegion;
}

/**
 * Builds a keymap with one binding per supplied action id.
 *
 * @param bindings - Action id to binding string pairs.
 * @returns A resolved keymap with only those bindings.
 */
function createKeymap(bindings: Readonly<Record<string, string>>): ResolvedKeymap {
  const parsed = new Map<string, readonly ParsedBinding[]>();

  for (const [actionId, binding] of Object.entries(bindings)) {
    const value = parseBinding(binding, "linux");

    if (value !== null) {
      parsed.set(actionId, [value]);
    }
  }

  return {
    platform: "linux",
    bindings: parsed,
    contexts: new Map(),
    conflicts: [],
    warnings: [],
  };
}

/**
 * Builds a repository surface that records every availability read.
 *
 * @param calls - Array the reads are appended to.
 * @returns The fake availability source.
 */
function createAvailabilitySource(calls: AvailabilityCall[]): PaletteAvailabilitySource {
  return {
    getAvailability(
      commandId: string,
      target: CommandTarget,
      region: CommandRegion,
    ): CommandAvailability {
      calls.push({ commandId, target, region });

      return { available: true };
    },
  };
}

describe("capturePaletteEntries", () => {
  it("captures every palette-invocable descriptor in catalogue order", () => {
    const captured = capturePaletteEntries({
      repository: createAvailabilitySource([]),
      keymap: createKeymap({}),
      deriveTarget: (): CommandTarget => ({ kind: "none" }),
    });
    const expected = listCommandDescriptors()
      .filter((descriptor) => descriptor.paletteInvocable)
      .map((descriptor) => descriptor.id);

    expect(captured.map((entry) => entry.descriptor.id)).toEqual(expected);
    expect(captured.some((entry) => entry.descriptor.id.startsWith("nav."))).toBe(false);
    expect(captured.length).toBeGreaterThan(40);
  });

  it("reads the target from the shared derivation and availability in the palette region", () => {
    const calls: AvailabilityCall[] = [];
    const captured = capturePaletteEntries({
      repository: createAvailabilitySource(calls),
      keymap: createKeymap({}),
      deriveTarget: (): CommandTarget => ({ kind: "branch", name: "feature" }),
    });
    const globalEntry = captured.find((entry) => entry.descriptor.id === "app.refresh");
    const branchEntry = captured.find((entry) => entry.descriptor.id === "branch.delete");

    expect(globalEntry?.target).toEqual({ kind: "branch", name: "feature" });
    expect(globalEntry?.availability).toEqual({ available: true });
    expect(calls.find((call) => call.commandId === "app.refresh")?.region).toBe("overlay");
    expect(calls.find((call) => call.commandId === "branch.delete")?.region).toBe("branches");
    expect(branchEntry?.target).toEqual({ kind: "branch", name: "feature" });
  });

  it("shows the effective shortcut or the unbound label from the resolved keymap", () => {
    const captured = capturePaletteEntries({
      repository: createAvailabilitySource([]),
      keymap: createKeymap({ "app.palette": "ctrl+p" }),
      deriveTarget: (): CommandTarget => ({ kind: "none" }),
    });
    const paletteEntry = captured.find((entry) => entry.descriptor.id === "app.palette");
    const unboundEntry = captured.find((entry) => entry.descriptor.id === "branch.delete");

    expect(paletteEntry?.shortcuts).toEqual(["Ctrl+P"]);
    expect(paletteEntry?.shortcut).toBe("Ctrl+P");
    expect(unboundEntry?.shortcuts).toEqual([]);
    expect(unboundEntry?.shortcut).toBe(PALETTE_UNBOUND_LABEL);
  });
});

describe("configured remote fetch entries", () => {
  it("offers exactly the configured remotes including upstream and preserves slash names", () => {
    const remotes = ["origin", "upstream", "team/upstream"];
    const calls: unknown[] = [];
    const captured = capturePaletteEntries({
      repository: {
        getAvailability: (commandId, target, region, formValues) => {
          if (commandId === "remote.fetch") {
            calls.push({ target, region, formValues });
          }
          return { available: true };
        },
      },
      keymap: createKeymap({ "remote.fetch": "f" }),
      remotes,
      deriveTarget: () => ({ kind: "none" }),
    }).filter((entry) => entry.fetchRemote !== undefined);
    expect(captured.map((entry) => entry.descriptor.label)).toEqual(
      remotes.map((remote) => `Fetch ${remote}`),
    );
    expect(captured.map((entry) => entry.descriptor.id)).toEqual(
      remotes.map((remote) => `remote.fetch:${remote}`),
    );
    expect(captured.every((entry) => entry.shortcuts.length === 0)).toBeTrue();
    expect(calls).toEqual(
      remotes.map((remote) => ({
        target: { kind: "none" },
        region: "overlay",
        formValues: { remote },
      })),
    );
  });

  it("offers no fetch remote when none exists, and does not invent origin beside upstream", () => {
    for (const remotes of [[], ["upstream"]]) {
      const captured = capturePaletteEntries({
        repository: createAvailabilitySource([]),
        keymap: createKeymap({}),
        remotes,
        deriveTarget: () => ({ kind: "none" }),
      });
      expect(
        captured
          .filter((entry) => entry.fetchRemote !== undefined)
          .map((entry) => entry.fetchRemote),
      ).toEqual(remotes);
      expect(captured.some((entry) => entry.descriptor.id === "remote.fetch")).toBeFalse();
    }
  });
});
