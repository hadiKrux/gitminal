import { describe, expect, it } from "bun:test";
import {
  collectUnboundWarnings,
  formatConflictWarning,
  projectContexts,
  settleConflicts,
} from "@/domain/keymap/keymap.conflicts";
import {
  ACTION_CATALOGUE,
  type ActionId,
  readDefaultBindings,
} from "@/domain/keymap/keymap.defaults";
import { bindingKey, parseBinding } from "@/domain/keymap/keymap.parse";
import { resolveKeymap } from "@/domain/keymap/keymap.resolve";
import type { KeymapContext, ParsedBinding } from "@/domain/keymap/keymap.types";

/**
 * Parses a binding and fails the test when it is invalid.
 *
 * @param value - Binding text.
 * @returns The parsed binding.
 */
function parseValid(value: string): ParsedBinding {
  const parsed = parseBinding(value, "linux");

  expect(parsed).not.toBeNull();

  return parsed as ParsedBinding;
}

/**
 * Builds a binding map containing only the supplied actions.
 *
 * @param entries - Action ID and binding pairs.
 * @returns A mutable action-to-bindings map.
 */
function bindingMap(
  entries: readonly (readonly [ActionId, readonly ParsedBinding[]])[],
): Map<ActionId, readonly ParsedBinding[]> {
  return new Map(entries);
}

/**
 * Builds the full catalogue default map, as the resolver starts from it.
 *
 * @returns A mutable action-to-bindings map.
 */
function defaultMap(): Map<ActionId, readonly ParsedBinding[]> {
  return bindingMap(
    ACTION_CATALOGUE.map((action) => [action.id, readDefaultBindings(action.id, "linux")] as const),
  );
}

describe("projectContexts", () => {
  it("projects every catalogue default without conflicts", () => {
    const projection = projectContexts(defaultMap());

    expect(projection.conflicts).toEqual([]);
    expect(projection.contexts.get("global")?.get("q")).toBe("app.quit");
    expect(projection.contexts.get("diff")?.get("enter")).toBe("diff.toggle");
  });

  it("reports two actions that claim the same key in one context", () => {
    const projection = projectContexts(
      bindingMap([
        ["app.quit", [parseValid("q")]],
        ["app.refresh", [parseValid("q")]],
      ]),
    );

    expect(projection.conflicts).toEqual([
      { context: "global", key: "q", displayKey: "q", actions: ["app.quit", "app.refresh"] },
    ]);
  });
});

describe("settleConflicts", () => {
  it("resets a conflicting override to its default and names both actions", () => {
    const bindings = defaultMap();
    const overridden = new Set<ActionId>(["app.help"]);

    bindings.set("app.help", [parseValid("r")]);

    const settled = settleConflicts(bindings, overridden, "linux");

    expect(settled.conflicts).toEqual([]);
    expect(settled.contexts.get("global")?.get("r")).toBe("app.refresh");
    expect(bindings.get("app.help")?.map(bindingKey)).toEqual(["?", "f1"]);
    expect(overridden.has("app.help")).toBe(false);
    expect(settled.warnings).toEqual([
      'Conflicting key "r" in context "global" for "app.help" and "app.refresh".',
    ]);
  });

  it("resets both overrides when their own values collide", () => {
    const bindings = defaultMap();
    const overridden = new Set<ActionId>(["app.help", "app.refresh"]);

    bindings.set("app.help", [parseValid("x")]);
    bindings.set("app.refresh", [parseValid("x")]);

    const settled = settleConflicts(bindings, overridden, "linux");

    expect(settled.conflicts).toEqual([]);
    expect(settled.warnings).toHaveLength(1);
    expect(bindings.get("app.help")?.map(bindingKey)).toEqual(["?", "f1"]);
    expect(bindings.get("app.refresh")?.map(bindingKey)).toEqual(["r"]);
    expect(overridden.size).toBe(0);
  });

  it("returns a default collision it cannot settle without warnings", () => {
    const settled = settleConflicts(
      bindingMap([
        ["app.quit", [parseValid("q")]],
        ["app.refresh", [parseValid("q")]],
      ]),
      new Set(),
      "linux",
    );

    expect(settled.warnings).toEqual([]);
    expect(settled.conflicts).toHaveLength(1);
    expect(settled.conflicts[0]?.context).toBe("global");
    expect(settled.conflicts[0]?.actions).toEqual(["app.quit", "app.refresh"]);
  });

  it("formats a conflict as a readable warning", () => {
    expect(
      formatConflictWarning({
        context: "diff",
        key: "d",
        displayKey: "D",
        actions: ["diff.discard", "diff.discardAll"],
      }),
    ).toBe('Conflicting key "D" in context "diff" for "diff.discard" and "diff.discardAll".');
  });
});

describe("collectUnboundWarnings", () => {
  it("warns for every required action that has no binding", () => {
    const bindings = defaultMap();

    bindings.set("app.quit", []);
    bindings.set("app.help", []);
    bindings.set("app.palette", []);

    const { contexts } = projectContexts(bindings);
    const warnings = collectUnboundWarnings(bindings, contexts);

    expect(warnings).toContain('Action "app.quit" has no binding.');
    expect(warnings).toContain('Action "app.help" has no binding.');
    expect(warnings).toContain('Action "app.palette" has no binding.');
  });

  it("counts a required action as unbound when only the reserved quit chord claimed its key", () => {
    const bindings = defaultMap();

    bindings.set("app.help", [parseValid("ctrl+c")]);

    const projection = projectContexts(bindings);
    const contexts = new Map<KeymapContext, ReadonlyMap<string, string>>(projection.contexts);
    const global = new Map(contexts.get("global") ?? []);

    global.set("ctrl+c", "app.quit");
    contexts.set("global", global);

    expect(collectUnboundWarnings(bindings, contexts)).toContain(
      'Action "app.help" has no binding.',
    );
  });
});

describe("readDefaultBindings", () => {
  it("returns each action's built-in bindings for the platform", () => {
    expect(readDefaultBindings("app.palette", "linux").map(bindingKey)).toEqual(["ctrl+p", "f2"]);
    expect(readDefaultBindings("app.palette", "macos").map(bindingKey)).toEqual([
      "ctrl+p",
      "meta+p",
      "f2",
    ]);
  });
});

describe("resolveKeymap conflict handling", () => {
  it("reports a digit rebound to another action in the global context", () => {
    const keymap = resolveKeymap({
      config: { "focus.region.branches": ["r"] },
      platform: "linux",
    });

    expect(keymap.bindings.get("focus.region.branches")?.map(bindingKey)).toEqual(["1"]);
    expect(keymap.contexts.get("global")?.get("1")).toBe("focus.region.branches");
    expect(
      keymap.warnings.some(
        (warning) =>
          warning.includes("focus.region.branches") &&
          warning.includes("app.refresh") &&
          warning.includes('"r"'),
      ),
    ).toBe(true);
  });

  it("does not treat two keys of the same action as a conflict", () => {
    const keymap = resolveKeymap({ platform: "linux" });

    expect(keymap.conflicts).toEqual([]);
    expect(keymap.bindings.get("app.palette")?.map(bindingKey)).toEqual(["ctrl+p", "f2"]);
  });
});
