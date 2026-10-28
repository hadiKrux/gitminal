import { describe, expect, it } from "bun:test";
import {
  ACTION_CATALOGUE,
  KEYMAP_CONTEXTS,
  REQUIRED_BINDING_ACTIONS,
} from "@/domain/keymap/keymap.defaults";
import { bindingKey } from "@/domain/keymap/keymap.parse";
import { resolveKeymap } from "@/domain/keymap/keymap.resolve";
import type {
  KeybindingOverrides,
  KeymapContext,
  ResolvedKeymap,
} from "@/domain/keymap/keymap.types";

/** Region context names documented in the architecture, in region order. */
const DOCUMENTED_REGION_IDS = [
  "top-bar",
  "branches",
  "remotes",
  "tags",
  "stashes",
  "worktrees",
  "graph",
  "right-pane",
  "diff",
  "console",
] as const;

/** Contexts that bind the shared horizontal navigation actions. */
const HORIZONTAL_NAV_CONTEXTS: readonly KeymapContext[] = ["top-bar", "right-pane", "overlay"];

/** List contexts where the product spec does not define shared paging. */
const UNPAGED_CONTEXTS: readonly KeymapContext[] = [
  "branches",
  "remotes",
  "tags",
  "stashes",
  "worktrees",
  "diff",
];

/** Contexts where the catalogue defines shared paging. */
const PAGED_CONTEXTS: readonly KeymapContext[] = ["graph", "console", "overlay"];

/** Contexts where the catalogue defines shared first/last movement. */
const FIRST_LAST_CONTEXTS: readonly KeymapContext[] = [
  "branches",
  "remotes",
  "graph",
  "console",
  "overlay",
];

/** Contexts that deliberately do not bind shared first/last movement. */
const FIRST_LAST_ABSENT_CONTEXTS: readonly KeymapContext[] = [
  "tags",
  "stashes",
  "worktrees",
  "diff",
];

/** Focus actions in screen order and their default digits. */
const REGION_DEFAULTS: readonly [string, string][] = [
  ["focus.region.branches", "1"],
  ["focus.region.remotes", "2"],
  ["focus.region.tags", "3"],
  ["focus.region.stashes", "4"],
  ["focus.region.worktrees", "5"],
  ["focus.region.graph", "6"],
  ["focus.region.rightPane", "7"],
  ["focus.region.diff", "8"],
  ["focus.region.console", "9"],
];

/** Actions that intentionally have no default binding. */
const UNBOUND_BY_DEFAULT = [
  "remote.pushForceSafe",
  "remote.pushForceOverwrite",
  "remote.pushNoVerify",
  "commit.submitNoVerify",
  "commit.amend",
  "commit.amendNoVerify",
  "app.reloadConfig",
  "focus.region.topBar",
  "diff.deleteUntracked",
  "diff.deleteAllUntracked",
];

/** Actions that scroll the diff viewport and the plain-letter or Shift+Arrow keys they own. */
const DIFF_SCROLL_DEFAULTS: readonly [string, readonly string[]][] = [
  ["diff.scrollDown", ["shift+j"]],
  ["diff.scrollUp", ["shift+k"]],
  ["diff.scrollFastDown", ["shift+down"]],
  ["diff.scrollFastUp", ["shift+up"]],
  ["diff.scrollLeft", ["shift+h", "shift+left"]],
  ["diff.scrollRight", ["shift+l", "shift+right"]],
];

/** Contexts that must never bind the diff viewport scrolling chords. */
const DIFF_SCROLL_ABSENT_CONTEXTS: readonly KeymapContext[] = [
  "branches",
  "graph",
  "global",
  "overlay",
];

/**
 * Reads the canonical keys bound to one action.
 *
 * @param keymap - Resolved keymap.
 * @param actionId - Action to inspect.
 * @returns The canonical binding identifiers.
 */
function actionKeys(keymap: ResolvedKeymap, actionId: string): string[] {
  return (keymap.bindings.get(actionId) ?? []).map(bindingKey);
}

/**
 * Reads the action bound to a key in one context.
 *
 * @param keymap - Resolved keymap.
 * @param context - Context to inspect.
 * @param key - Canonical lookup key.
 * @returns The action ID, or `undefined` when the key is unbound.
 */
function actionForKey(
  keymap: ResolvedKeymap,
  context: KeymapContext,
  key: string,
): string | undefined {
  return keymap.contexts.get(context)?.get(key);
}

/**
 * Reports whether any warning mentions every fragment.
 *
 * @param warnings - Warning list.
 * @param fragments - Fragments that must all appear in one warning.
 * @returns `true` when a matching warning exists.
 */
function hasWarning(warnings: readonly string[], ...fragments: string[]): boolean {
  return warnings.some((warning) => fragments.every((fragment) => warning.includes(fragment)));
}

describe("resolveKeymap defaults", () => {
  it("resolves every catalogue action", () => {
    const keymap = resolveKeymap({ platform: "linux" });

    expect(keymap.bindings.size).toBe(ACTION_CATALOGUE.length);
    expect(keymap.conflicts).toEqual([]);
  });

  it("binds the direct region jumps to the digits in screen order", () => {
    const keymap = resolveKeymap({ platform: "linux" });

    for (const [actionId, digit] of REGION_DEFAULTS) {
      expect(actionKeys(keymap, actionId)).toEqual([digit]);
      expect(actionForKey(keymap, "global", digit)).toBe(actionId);
    }

    expect(actionKeys(keymap, "focus.region.topBar")).toEqual([]);
  });

  it("binds both alternative keys for help and the palette", () => {
    const keymap = resolveKeymap({ platform: "linux" });

    expect(actionKeys(keymap, "app.help")).toEqual(["?", "f1"]);
    expect(actionKeys(keymap, "app.palette")).toEqual(["ctrl+p", "f2"]);
    expect(actionKeys(keymap, "form.submit")).toEqual(["ctrl+enter"]);
  });

  it("keeps S section-scoped and binds the global stage-all action to A", () => {
    const keymap = resolveKeymap({ platform: "linux" });

    expect(actionKeys(keymap, "diff.stageAll")).toEqual(["shift+s"]);
    expect(actionKeys(keymap, "diff.stageAllUnstaged")).toEqual(["shift+a"]);
    expect(actionForKey(keymap, "diff", "shift+s")).toBe("diff.stageAll");
    expect(actionForKey(keymap, "global", "shift+a")).toBe("diff.stageAllUnstaged");
  });

  it("binds the legacy console chord on WSL", () => {
    const keymap = resolveKeymap({ platform: "wsl" });

    expect(actionKeys(keymap, "app.console")).toEqual(["ctrl+`", "ctrl+space"]);
    expect(actionForKey(keymap, "global", "ctrl+space")).toBe("app.console");
  });

  it.each(["linux", "macos", "windows"] as const)(
    "does not add the WSL console alias on %s",
    (platform) => {
      const keymap = resolveKeymap({ platform });

      expect(actionForKey(keymap, "global", "ctrl+space")).toBeUndefined();
    },
  );

  it("lets console overrides replace the legacy alias too", () => {
    const keymap = resolveKeymap({ platform: "wsl", keybindings: { "app.console": "f4" } });

    expect(actionKeys(keymap, "app.console")).toEqual(["f4"]);
    expect(actionForKey(keymap, "global", "ctrl+space")).toBeUndefined();
  });

  it("expands mod to Command on macOS", () => {
    const keymap = resolveKeymap({ platform: "macos" });

    expect(actionKeys(keymap, "app.palette")).toEqual(["ctrl+p", "meta+p", "f2"]);
    expect(actionKeys(keymap, "app.console")).toEqual(["ctrl+`", "meta+`"]);
    expect(actionKeys(keymap, "form.submit")).toEqual(["ctrl+enter", "meta+enter"]);
  });

  it("leaves the documented variants unbound", () => {
    const keymap = resolveKeymap({ platform: "linux" });

    for (const actionId of UNBOUND_BY_DEFAULT) {
      expect(actionKeys(keymap, actionId)).toEqual([]);
    }
  });

  it("allows one key in different contexts and keeps context bindings separate", () => {
    const keymap = resolveKeymap({ platform: "linux" });

    expect(actionForKey(keymap, "global", "p")).toBe("remote.pull");
    expect(actionForKey(keymap, "stashes", "p")).toBe("stash.pop");
    expect(actionForKey(keymap, "stashes", "d")).toBe("stash.delete");
    expect(actionForKey(keymap, "tags", "shift+p")).toBe("tag.push");
    expect(actionForKey(keymap, "diff", "enter")).toBe("diff.toggle");
    expect(actionForKey(keymap, "diff", "d")).toBe("diff.discard");
    expect(actionForKey(keymap, "diff", "shift+d")).toBe("diff.discardAll");
  });

  it("uses the documented region IDs as its region contexts", () => {
    const regionContexts = KEYMAP_CONTEXTS.filter(
      (context) => context !== "global" && context !== "overlay",
    );

    expect(regionContexts).toEqual([...DOCUMENTED_REGION_IDS]);
    expect(Object.isFrozen(KEYMAP_CONTEXTS)).toBe(true);
    expect(Reflect.set(KEYMAP_CONTEXTS, 0, "overlay")).toBe(false);
  });

  it("binds shared paging and first/last only where the catalogue defines them", () => {
    const keymap = resolveKeymap({ platform: "linux" });

    for (const context of UNPAGED_CONTEXTS) {
      expect(actionForKey(keymap, context, "pageup"), context).toBeUndefined();
      expect(actionForKey(keymap, context, "pagedown"), context).toBeUndefined();
    }

    for (const context of PAGED_CONTEXTS) {
      expect(actionForKey(keymap, context, "pageup"), context).toBe("nav.pageUp");
      expect(actionForKey(keymap, context, "pagedown"), context).toBe("nav.pageDown");
    }

    for (const context of FIRST_LAST_ABSENT_CONTEXTS) {
      expect(actionForKey(keymap, context, "g"), context).toBeUndefined();
      expect(actionForKey(keymap, context, "shift+g"), context).toBeUndefined();
    }

    for (const context of FIRST_LAST_CONTEXTS) {
      expect(actionForKey(keymap, context, "g"), context).toBe("nav.first");
      expect(actionForKey(keymap, context, "shift+g"), context).toBe("nav.last");
    }
  });

  it("binds vertical navigation in the right pane for its parent list", () => {
    const keymap = resolveKeymap({ platform: "linux" });

    expect(actionForKey(keymap, "right-pane", "up")).toBe("nav.up");
    expect(actionForKey(keymap, "right-pane", "down")).toBe("nav.down");
    expect(actionForKey(keymap, "right-pane", "k")).toBe("nav.up");
    expect(actionForKey(keymap, "right-pane", "j")).toBe("nav.down");
  });

  it("freezes the catalogue, each action, and the shared binding containers", () => {
    expect(Object.isFrozen(ACTION_CATALOGUE)).toBe(true);
    expect(Object.isFrozen(REQUIRED_BINDING_ACTIONS)).toBe(true);

    for (const action of ACTION_CATALOGUE) {
      expect(Object.isFrozen(action), action.id).toBe(true);
      expect(Object.isFrozen(action.contexts), action.id).toBe(true);
      expect(Object.isFrozen(action.defaults), action.id).toBe(true);
    }

    expect(Reflect.set(ACTION_CATALOGUE[0], "label", "Changed")).toBe(false);
    expect(Reflect.set(ACTION_CATALOGUE[0].defaults, 0, "ctrl+q")).toBe(false);
    expect(Reflect.set(REQUIRED_BINDING_ACTIONS, 0, "app.refresh")).toBe(false);
  });

  it("binds the shared navigation actions in the top bar, right pane, and overlays", () => {
    const keymap = resolveKeymap({ platform: "linux" });

    expect(actionKeys(keymap, "nav.activate")).toEqual(["enter"]);
    expect(actionKeys(keymap, "nav.left")).toEqual(["left", "h"]);
    expect(actionKeys(keymap, "nav.right")).toEqual(["right", "l"]);

    for (const context of HORIZONTAL_NAV_CONTEXTS) {
      expect(actionForKey(keymap, context, "enter")).toBe("nav.activate");
      expect(actionForKey(keymap, context, "left")).toBe("nav.left");
      expect(actionForKey(keymap, context, "h")).toBe("nav.left");
      expect(actionForKey(keymap, context, "right")).toBe("nav.right");
      expect(actionForKey(keymap, context, "l")).toBe("nav.right");
    }
  });

  it("keeps h and l on expand and collapse inside the diff context", () => {
    const keymap = resolveKeymap({ platform: "linux" });

    expect(actionForKey(keymap, "diff", "h")).toBe("nav.collapse");
    expect(actionForKey(keymap, "diff", "l")).toBe("nav.expand");
    expect(keymap.conflicts).toEqual([]);
  });

  it("injects the non-overridable Ctrl+C quit chord into every context", () => {
    const keymap = resolveKeymap({ platform: "linux" });

    for (const context of keymap.contexts.keys()) {
      expect(actionForKey(keymap, context, "ctrl+c")).toBe("app.quit");
    }
  });
});

describe("resolveKeymap diff viewport scrolling", () => {
  it("binds the six diff scroll actions to their plain-letter and Shift+Arrow chords", () => {
    const keymap = resolveKeymap({ platform: "linux" });

    for (const [actionId, keys] of DIFF_SCROLL_DEFAULTS) {
      expect(actionKeys(keymap, actionId), actionId).toEqual([...keys]);

      for (const key of keys) {
        expect(actionForKey(keymap, "diff", key), `${actionId}:${key}`).toBe(actionId);
      }
    }

    expect(keymap.conflicts).toEqual([]);
  });

  it("keeps unmodified row navigation and expansion unchanged in the diff context", () => {
    const keymap = resolveKeymap({ platform: "linux" });

    expect(actionForKey(keymap, "diff", "j")).toBe("nav.down");
    expect(actionForKey(keymap, "diff", "k")).toBe("nav.up");
    expect(actionForKey(keymap, "diff", "h")).toBe("nav.collapse");
    expect(actionForKey(keymap, "diff", "l")).toBe("nav.expand");
    expect(actionForKey(keymap, "diff", "down")).toBe("nav.down");
    expect(actionForKey(keymap, "diff", "up")).toBe("nav.up");
    expect(actionForKey(keymap, "diff", "left")).toBe("nav.collapse");
    expect(actionForKey(keymap, "diff", "right")).toBe("nav.expand");
  });

  it("leaves every diff scroll chord unbound outside the diff context", () => {
    const keymap = resolveKeymap({ platform: "linux" });
    const keys = [...new Set(DIFF_SCROLL_DEFAULTS.flatMap(([, defaults]) => defaults))];

    for (const context of DIFF_SCROLL_ABSENT_CONTEXTS) {
      for (const key of keys) {
        expect(actionForKey(keymap, context, key), `${context}:${key}`).toBeUndefined();
      }
    }
  });
});

describe("resolveKeymap override layers", () => {
  it("applies config overrides and lets keybindings.json win for the same action", () => {
    const keymap = resolveKeymap({
      config: { "app.refresh": ["x"] },
      keybindings: { "app.refresh": ["z"] },
      platform: "linux",
    });

    expect(actionKeys(keymap, "app.refresh")).toEqual(["z"]);
    expect(actionForKey(keymap, "global", "z")).toBe("app.refresh");
    expect(actionForKey(keymap, "global", "x")).toBeUndefined();
  });

  it("keeps actions that no layer mentions at their default", () => {
    const keymap = resolveKeymap({
      config: { "app.refresh": ["x"] },
      platform: "linux",
    });

    expect(actionKeys(keymap, "app.quit")).toEqual(["q"]);
    expect(actionKeys(keymap, "remote.fetch")).toEqual(["f"]);
  });

  it("treats a string and an array as full replacement", () => {
    const single = resolveKeymap({ config: { "app.help": "h" }, platform: "linux" });
    const list = resolveKeymap({ config: { "app.help": ["h", "?"] }, platform: "linux" });

    expect(actionKeys(single, "app.help")).toEqual(["h"]);
    expect(actionKeys(list, "app.help")).toEqual(["h", "?"]);
  });

  it("resets to the built-in default with null", () => {
    const keymap = resolveKeymap({
      config: { "app.refresh": ["x"] },
      keybindings: { "app.refresh": null },
      platform: "linux",
    });

    expect(actionKeys(keymap, "app.refresh")).toEqual(["r"]);
    expect(actionForKey(keymap, "global", "x")).toBeUndefined();
  });

  it("unbinds an action with an empty array", () => {
    const keymap = resolveKeymap({ config: { "app.refresh": [] }, platform: "linux" });

    expect(actionKeys(keymap, "app.refresh")).toEqual([]);
    expect(actionForKey(keymap, "global", "r")).toBeUndefined();
  });

  it("warns about unknown action IDs and ignores them", () => {
    const keymap = resolveKeymap({
      config: { "graph.selectCommit": ["x"] } as unknown as KeybindingOverrides,
      platform: "linux",
    });

    expect(actionForKey(keymap, "global", "x")).toBeUndefined();
    expect(hasWarning(keymap.warnings, "graph.selectCommit", "Unknown action ID")).toBe(true);
  });

  it("warns about an invalid binding and keeps the previous effective value", () => {
    const keymap = resolveKeymap({
      config: { "app.refresh": ["x"] },
      keybindings: { "app.refresh": ["not+a+real+key"] },
      platform: "linux",
    });

    expect(actionKeys(keymap, "app.refresh")).toEqual(["x"]);
    expect(hasWarning(keymap.warnings, "app.refresh", "previous binding was kept")).toBe(true);
  });

  it("warns about an invalid value shape and keeps the previous effective value", () => {
    const keymap = resolveKeymap({
      config: { "app.refresh": 42 } as unknown as KeybindingOverrides,
      platform: "linux",
    });

    expect(actionKeys(keymap, "app.refresh")).toEqual(["r"]);
    expect(hasWarning(keymap.warnings, "app.refresh", "Invalid binding value")).toBe(true);
  });
});

describe("resolveKeymap conflicts", () => {
  it("rejects a conflicting override, restores the default, and names both actions", () => {
    const keymap = resolveKeymap({
      config: { "app.help": ["r"] },
      platform: "linux",
    });

    expect(actionKeys(keymap, "app.help")).toEqual(["?", "f1"]);
    expect(actionForKey(keymap, "global", "r")).toBe("app.refresh");
    expect(hasWarning(keymap.warnings, "app.help", "app.refresh", '"r"')).toBe(true);
  });

  it("keeps Ctrl+C reserved when another action tries to use it", () => {
    const keymap = resolveKeymap({
      config: { "app.help": ["ctrl+c"] },
      platform: "linux",
    });

    expect(actionForKey(keymap, "global", "ctrl+c")).toBe("app.quit");
    expect(hasWarning(keymap.warnings, "reserved", "app.help")).toBe(true);
    expect(hasWarning(keymap.warnings, "app.help", "no binding")).toBe(true);
  });
});
