import { describe, expect, it } from "bun:test";
import { ACTION_CATALOGUE } from "@/domain/keymap/keymap.defaults";
import {
  describeFooterHints,
  describeHelpRows,
  formatBinding,
} from "@/domain/keymap/keymap.describe";
import { bindingKey, parseBinding } from "@/domain/keymap/keymap.parse";
import { resolveKeymap } from "@/domain/keymap/keymap.resolve";
import type { KeymapContext, KeymapPlatform, ParsedBinding } from "@/domain/keymap/keymap.types";

/**
 * Parses a binding and fails the test when it is invalid.
 *
 * @param value - Binding text.
 * @param platform - Platform used to expand `mod`.
 * @returns The parsed binding.
 */
function parseValid(value: string, platform: KeymapPlatform = "linux"): ParsedBinding {
  const parsed = parseBinding(value, platform);

  expect(parsed).not.toBeNull();

  return parsed as ParsedBinding;
}

describe("formatBinding", () => {
  it("formats named keys, function keys, and chords", () => {
    expect(formatBinding(parseValid("enter"))).toBe("Enter");
    expect(formatBinding(parseValid("shift+tab"))).toBe("Shift+Tab");
    expect(formatBinding(parseValid("ctrl+backtick"))).toBe("Ctrl+`");
    expect(formatBinding(parseValid("f1"))).toBe("F1");
  });

  it("keeps a plain letter lowercase and renders a shifted letter uppercase", () => {
    expect(formatBinding(parseValid("q"))).toBe("q");
    expect(formatBinding(parseValid("P"))).toBe("P");
    expect(formatBinding(parseValid("shift+p"))).toBe("P");
  });

  it("uppercases a single-letter base key whenever a modifier is present", () => {
    expect(formatBinding(parseValid("ctrl+p"))).toBe("Ctrl+P");
    expect(formatBinding(parseValid("mod+p", "macos"))).toBe("Cmd+P");
    expect(formatBinding(parseValid("ctrl+c"))).toBe("Ctrl+C");
    expect(formatBinding(parseValid("ctrl+shift+p"))).toBe("Ctrl+Shift+P");
    expect(formatBinding(parseValid("alt+h"))).toBe("Alt+H");
  });

  it("leaves symbols and named keys unchanged by modifier casing", () => {
    expect(formatBinding(parseValid("ctrl+enter"))).toBe("Ctrl+Enter");
    expect(formatBinding(parseValid("?"))).toBe("?");
    expect(formatBinding(parseValid("ctrl+/"))).toBe("Ctrl+/");
  });

  it("omits Shift for symbols and digits whose Shift lookup ignores", () => {
    expect(formatBinding(parseValid("shift+/"))).toBe("/");
    expect(formatBinding(parseValid("shift+?"))).toBe("?");
    expect(formatBinding(parseValid("shift+1"))).toBe("1");
    expect(formatBinding(parseValid("shift+tab"))).toBe("Shift+Tab");
    expect(formatBinding(parseValid("ctrl+shift+p"))).toBe("Ctrl+Shift+P");
  });

  it("produces display strings that are not binding inputs", () => {
    const formatted = formatBinding(parseValid("ctrl+p"));

    expect(formatted).toBe("Ctrl+P");
    expect(bindingKey(parseValid(formatted))).toBe("ctrl+shift+p");
  });
});

describe("describeFooterHints", () => {
  it("lists context actions before globals and hides direct focus actions", () => {
    const keymap = resolveKeymap({ platform: "linux" });
    const hints = describeFooterHints(keymap, "branches");

    const branchCreate = hints.findIndex((hint) => hint.actionId === "branch.create");
    const quit = hints.findIndex((hint) => hint.actionId === "app.quit");

    expect(branchCreate).toBeGreaterThanOrEqual(0);
    expect(quit).toBeGreaterThan(branchCreate);
    expect(hints.some((hint) => hint.actionId === "app.quit")).toBe(true);
    expect(hints.some((hint) => hint.actionId.startsWith("focus.region."))).toBe(false);
  });

  it("drops a global hint when the focused context owns the same key", () => {
    const keymap = resolveKeymap({ platform: "linux" });
    const hints = describeFooterHints(keymap, "stashes");

    expect(hints.some((hint) => hint.actionId === "stash.pop")).toBe(true);
    expect(hints.some((hint) => hint.actionId === "remote.pull")).toBe(false);
  });

  it("keeps only context hints when globals are excluded", () => {
    const keymap = resolveKeymap({ platform: "linux" });
    const contextActions = new Set(keymap.contexts.get("branches")?.values() ?? []);
    const hints = describeFooterHints(keymap, "branches", { includeGlobals: false });

    expect(hints.length).toBeGreaterThan(0);
    expect(hints.every((hint) => contextActions.has(hint.actionId))).toBe(true);
    expect(hints.some((hint) => hint.actionId === "branch.create")).toBe(true);
    expect(hints.some((hint) => hint.actionId === "app.help")).toBe(false);
  });

  it("keeps help first and filters by availability", () => {
    const keymap = resolveKeymap({ platform: "linux" });
    const hints = describeFooterHints(keymap, "global", {
      isAvailable: (actionId) => actionId === "app.help" || actionId === "app.quit",
    });

    expect(hints.map((hint) => hint.actionId)).toEqual(["app.help", "app.quit"]);
  });

  it("formats every effective binding of an action", () => {
    const keymap = resolveKeymap({ platform: "linux" });
    const hints = describeFooterHints(keymap, "global", {
      isAvailable: (actionId) => actionId === "app.help",
    });

    expect(hints[0]?.keys).toEqual(["?", "F1"]);
  });
});

describe("describeHelpRows", () => {
  it("returns every implemented action in catalogue order", () => {
    const keymap = resolveKeymap({ platform: "linux" });
    const rows = describeHelpRows(keymap);

    expect(rows.map((row) => row.actionId)).toEqual(ACTION_CATALOGUE.map((action) => action.id));
  });

  it("keeps unavailable and unbound actions with their effective keys", () => {
    const keymap = resolveKeymap({ platform: "linux" });
    const rows = describeHelpRows(keymap);
    const unbound = rows.find((row) => row.actionId === "focus.region.topBar");
    const help = rows.find((row) => row.actionId === "app.help");

    expect(unbound?.keys).toEqual([]);
    expect(unbound?.label).toBe("Focus top bar");
    expect(help?.keys).toEqual(["?", "F1"]);
    expect(help?.description).toContain("keybinding");
    expect(help?.contexts).toEqual(["global"]);
  });

  it("agrees with the footer hints on effective keys", () => {
    const keymap = resolveKeymap({ platform: "linux" });
    const rows = describeHelpRows(keymap);
    const contexts: readonly KeymapContext[] = ["global", "branches", "graph", "diff", "console"];

    for (const context of contexts) {
      for (const hint of describeFooterHints(keymap, context)) {
        const row = rows.find((candidate) => candidate.actionId === hint.actionId);

        expect(row?.keys, hint.actionId).toEqual(hint.keys);
      }
    }
  });

  it("attributes each binding to the preferred, fallback, or first context", () => {
    const keymap = resolveKeymap({ platform: "linux" });
    const rows = describeHelpRows(keymap, {
      preferredContext: "branches",
      fallbackContext: "overlay",
    });

    expect(readBindingContext(rows, "nav.up")).toBe("branches");
    expect(readBindingContext(rows, "nav.pageUp")).toBe("overlay");
    expect(readBindingContext(rows, "app.help")).toBe("global");

    const fallbackOnly = describeHelpRows(keymap, { preferredContext: "graph" });

    expect(readBindingContext(fallbackOnly, "nav.pageUp")).toBe("graph");
    expect(readBindingContext(fallbackOnly, "nav.left")).toBe("top-bar");
  });

  it("reflects a configured override in the effective keys", () => {
    const keymap = resolveKeymap({ platform: "linux", keybindings: { "stash.pop": "ctrl+p" } });
    const rows = describeHelpRows(keymap);

    expect(readKeys(rows, "stash.pop")).toEqual(["Ctrl+P"]);
  });
});

/**
 * Reads one help row's effective keys.
 *
 * @param rows - Described help rows.
 * @param actionId - Action to look up.
 * @returns The formatted keys, or undefined when the row is missing.
 */
function readKeys(
  rows: ReturnType<typeof describeHelpRows>,
  actionId: string,
): readonly string[] | undefined {
  return rows.find((row) => row.actionId === actionId)?.keys;
}

/**
 * Reads one help row's attributed binding context.
 *
 * @param rows - Described help rows.
 * @param actionId - Action to look up.
 * @returns The attributed context, or undefined when the row is missing.
 */
function readBindingContext(
  rows: ReturnType<typeof describeHelpRows>,
  actionId: string,
): KeymapContext | undefined {
  return rows.find((row) => row.actionId === actionId)?.bindingContext;
}
