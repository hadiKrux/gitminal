import { describe, expect, it } from "bun:test";
import { getCommandDescriptor, listCommandDescriptors } from "@/domain/commands/commands.registry";
import type { CommandDescriptor } from "@/domain/commands/commands.types";
import { ACTION_BY_ID, ACTION_CATALOGUE } from "@/domain/keymap/keymap.defaults";

/**
 * Catalogue actions that are intentionally key-only and have no command descriptor.
 *
 * Every entry is a keystroke intent owned by a focused surface, not a palette command: cursor
 * movement (`nav.*`), overlay and field traversal (`focus.next`, `focus.previous`, `overlay.close`,
 * `form.submit`), field triggers (`list.filter`, `help.search`, `commit.options`), the inline
 * toggles (`diff.toggle`, `console.clear`), and the global stage-all shortcut
 * (`diff.stageAllUnstaged`) that dispatches the bulk diff command with feature-owned paths. The
 * registry-completeness test fails when a new action is added without either a descriptor or an
 * explicit entry here.
 */
const KEY_ONLY_ACTION_IDS: readonly string[] = Object.freeze([
  "nav.up",
  "nav.down",
  "nav.pageUp",
  "nav.pageDown",
  "nav.first",
  "nav.last",
  "nav.activate",
  "nav.left",
  "nav.right",
  "nav.expand",
  "nav.collapse",
  "focus.next",
  "focus.previous",
  "overlay.close",
  "list.filter",
  "help.search",
  "commit.options",
  "form.submit",
  "diff.toggle",
  "diff.stageAllUnstaged",
  "console.clear",
]);

/** App commands the palette and help must list. */
const APP_COMMAND_IDS = [
  "app.help",
  "app.palette",
  "app.console",
  "app.quit",
  "app.reloadConfig",
  "app.themePicker",
] as const;

/** Direct region jumps the palette and help must list. */
const REGION_COMMAND_IDS = [
  "focus.region.topBar",
  "focus.region.branches",
  "focus.region.remotes",
  "focus.region.tags",
  "focus.region.stashes",
  "focus.region.worktrees",
  "focus.region.graph",
  "focus.region.rightPane",
  "focus.region.diff",
  "focus.region.console",
] as const;

/**
 * Reads a registered descriptor and asserts the fields every palette command shares.
 *
 * The catalogue and the keymap are joined by id, so an entry whose label or description disagrees
 * with its action is a copy-paste defect rather than a rendering one. Every palette command is
 * targetless, because the palette resolves a target at activation instead of holding one.
 *
 * @param commandId - Command id under test.
 * @param expected - The field values that vary between command groups.
 * @returns The registered descriptor.
 * @throws When the catalogue has no descriptor or no action for the id.
 */
function expectPaletteCommand(
  commandId: keyof typeof ACTION_BY_ID,
  expected: {
    readonly kind: CommandDescriptor["kind"];
    readonly scope: CommandDescriptor["scope"];
    readonly category: CommandDescriptor["category"];
    readonly needsInput: boolean;
  },
): CommandDescriptor {
  const descriptor = getCommandDescriptor(commandId);
  const action = ACTION_BY_ID[commandId];

  expect(descriptor, commandId).toBeDefined();

  if (descriptor === undefined || action === undefined) {
    throw new Error(`Missing catalogue entry for ${commandId}`);
  }

  expect(descriptor.kind, commandId).toBe(expected.kind);
  expect(descriptor.scope, commandId).toBe(expected.scope);
  expect(descriptor.targetKind, commandId).toBe("none");
  expect(descriptor.category, commandId).toBe(expected.category);
  expect(descriptor.paletteInvocable, commandId).toBeTrue();
  expect(descriptor.needsInput, commandId).toBe(expected.needsInput);
  expect(descriptor.label, commandId).toBe(action.label);
  expect(descriptor.description, commandId).toBe(action.description);

  return descriptor;
}

describe("command registry", () => {
  it("indexes every listed descriptor exactly once", () => {
    const descriptors = listCommandDescriptors();
    const ids = descriptors.map((descriptor) => descriptor.id);

    expect(descriptors.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);

    for (const descriptor of descriptors) {
      expect(getCommandDescriptor(descriptor.id)).toBe(descriptor);
      expect(Object.isFrozen(descriptor)).toBeTrue();
      expect(Object.isFrozen(descriptor.keywords)).toBeTrue();
    }
  });

  it("returns undefined for an unknown command", () => {
    expect(getCommandDescriptor("nope.nothing")).toBeUndefined();
  });

  it("requires a branch target for pull and every push variant", () => {
    for (const commandId of [
      "remote.pull",
      "remote.push",
      "remote.pushForceSafe",
      "remote.pushForceOverwrite",
      "remote.pushNoVerify",
    ]) {
      expect(getCommandDescriptor(commandId)?.targetKind).toBe("branch");
    }
  });

  it("keeps fetch, fetch-prune, and the More menu scope-wide", () => {
    for (const commandId of ["remote.fetch", "remote.fetchPrune", "remote.more"]) {
      expect(getCommandDescriptor(commandId)?.targetKind).toBe("none");
    }
  });

  it("keeps remote.more a navigation command", () => {
    expect(getCommandDescriptor("remote.more")?.kind).toBe("navigation");
  });

  it("declares the global handler scope for every remote command", () => {
    for (const commandId of [
      "remote.fetch",
      "remote.fetchPrune",
      "remote.pull",
      "remote.push",
      "remote.pushForceSafe",
      "remote.pushForceOverwrite",
      "remote.pushNoVerify",
      "remote.more",
    ]) {
      expect(getCommandDescriptor(commandId)?.scope, commandId).toBe("global");
    }
  });

  it("declares the internal selection commands without an action id", () => {
    expect(getCommandDescriptor("graph.selectCommit")?.actionId).toBeUndefined();
    expect(getCommandDescriptor("graph.selectPending")?.actionId).toBeUndefined();
    expect(getCommandDescriptor("stash.select")?.actionId).toBeUndefined();
    expect(getCommandDescriptor("worktree.select")?.actionId).toBeUndefined();

    for (const commandId of [
      "graph.selectCommit",
      "graph.selectPending",
      "stash.select",
      "worktree.select",
    ]) {
      const descriptor = getCommandDescriptor(commandId);

      expect(descriptor?.kind, commandId).toBe("navigation");
    }
  });

  it("keeps internal selection commands out of the palette", () => {
    const internalIds = [
      "graph.selectCommit",
      "graph.selectPending",
      "stash.select",
      "worktree.select",
    ];

    for (const commandId of internalIds) {
      expect(getCommandDescriptor(commandId)?.paletteInvocable, commandId).toBeFalse();
    }

    const paletteIds = listCommandDescriptors()
      .filter((descriptor) => descriptor.paletteInvocable)
      .map((descriptor) => descriptor.id);

    expect(paletteIds.length).toBeGreaterThan(0);

    for (const commandId of internalIds) {
      expect(paletteIds, commandId).not.toContain(commandId);
    }
  });

  it("targets pending for graph.selectPending and a commit for graph.selectCommit", () => {
    expect(getCommandDescriptor("graph.selectCommit")?.targetKind).toBe("commit");
    expect(getCommandDescriptor("graph.selectPending")?.targetKind).toBe("pending");
  });

  it("keeps every other command bound to its own action id", () => {
    for (const descriptor of listCommandDescriptors()) {
      if (
        descriptor.id === "graph.selectCommit" ||
        descriptor.id === "graph.selectPending" ||
        descriptor.id === "stash.select"
      ) {
        continue;
      }

      if (descriptor.id === "worktree.select") {
        continue;
      }

      expect(descriptor.actionId, descriptor.id).toBe(descriptor.id);
    }
  });

  it("lists every app command as a palette-invocable navigation command", () => {
    for (const commandId of APP_COMMAND_IDS) {
      expectPaletteCommand(commandId, {
        kind: "navigation",
        scope: "global",
        category: "app",
        needsInput: false,
      });
    }
  });

  it("lists every direct region jump under the focus category", () => {
    for (const commandId of REGION_COMMAND_IDS) {
      expectPaletteCommand(commandId, {
        kind: "navigation",
        scope: "global",
        category: "focus",
        needsInput: false,
      });
    }
  });

  it("names the region in every direct region jump label", () => {
    const expectedLabels = [
      ["focus.region.topBar", "Focus top bar"],
      ["focus.region.branches", "Focus branches"],
      ["focus.region.remotes", "Focus remotes"],
      ["focus.region.tags", "Focus tags"],
      ["focus.region.stashes", "Focus stashes"],
      ["focus.region.worktrees", "Focus worktrees"],
      ["focus.region.graph", "Focus commit graph"],
      ["focus.region.rightPane", "Focus right pane"],
      ["focus.region.diff", "Focus diffs"],
      ["focus.region.console", "Focus console"],
    ] as const;

    for (const [commandId, label] of expectedLabels) {
      expect(getCommandDescriptor(commandId)?.label, commandId).toBe(label);
    }
  });

  it("declares graph.search as a palette-invocable graph navigation command", () => {
    const descriptor = expectPaletteCommand("graph.search", {
      kind: "navigation",
      scope: "graph",
      category: "graph",
      needsInput: true,
    });

    expect(descriptor.actionId).toBe("graph.search");
  });

  it("keeps key-only intents out of the catalogue", () => {
    for (const actionId of [
      "nav.up",
      "nav.down",
      "nav.activate",
      "nav.first",
      "nav.last",
      "focus.next",
      "focus.previous",
      "list.filter",
      "help.search",
      "overlay.close",
      "form.submit",
      "diff.toggle",
      "commit.options",
      "console.clear",
    ]) {
      expect(getCommandDescriptor(actionId), actionId).toBeUndefined();
    }
  });

  it("covers every action id with a descriptor or a documented key-only exclusion", () => {
    const keyOnlyActionIds = KEY_ONLY_ACTION_IDS;

    for (const action of ACTION_CATALOGUE) {
      const descriptor = getCommandDescriptor(action.id);

      if (descriptor === undefined) {
        expect(keyOnlyActionIds, action.id).toContain(action.id);

        continue;
      }

      expect(keyOnlyActionIds, action.id).not.toContain(action.id);
      expect(descriptor.actionId, action.id).toBe(action.id);
    }

    for (const actionId of keyOnlyActionIds) {
      expect(
        ACTION_CATALOGUE.some((action) => action.id === actionId),
        actionId,
      ).toBeTrue();
      expect(getCommandDescriptor(actionId), actionId).toBeUndefined();
    }
  });

  it("declares commit.focus as a global navigation command", () => {
    const descriptor = expectPaletteCommand("commit.focus", {
      kind: "navigation",
      scope: "global",
      category: "commit",
      needsInput: false,
    });

    expect(descriptor.actionId).toBe("commit.focus");
  });

  it("keeps the bulk diff actions out of the palette and the per-file actions in it", () => {
    for (const commandId of [
      "diff.stageAll",
      "diff.unstageAll",
      "diff.discardAll",
      "diff.deleteAllUntracked",
    ]) {
      expect(getCommandDescriptor(commandId)?.paletteInvocable, commandId).toBeFalse();
    }

    for (const commandId of [
      "diff.stage",
      "diff.unstage",
      "diff.discard",
      "diff.deleteUntracked",
    ]) {
      expect(getCommandDescriptor(commandId)?.paletteInvocable, commandId).toBeTrue();
    }
  });

  it("keeps every nav action out of the catalogue", () => {
    expect(getCommandDescriptor("nav.up")).toBeUndefined();
    expect(getCommandDescriptor("nav.down")).toBeUndefined();
    expect(getCommandDescriptor("nav.activate")).toBeUndefined();

    for (const descriptor of listCommandDescriptors()) {
      expect(descriptor.id.startsWith("nav."), descriptor.id).toBeFalse();
    }
  });
});
