import { describe, expect, it } from "bun:test";
import { ICONS, type IconName } from "@/theme/icons";

/** Matches printable ASCII, space through tilde. */
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;

/** Required `ICONS` groups and names from architecture section 6.1. */
const REQUIRED_ICON_GROUPS: Readonly<Record<string, readonly IconName[]>> = {
  "Focus and selection": ["focus", "selected", "unselected"],
  Expansion: ["expanded", "collapsed"],
  "Branch and repo state": [
    "currentBranch",
    "worktree",
    "detached",
    "missingUpstream",
    "noUpstream",
    "locked",
    "prunable",
    "dirty",
  ],
  "File status": ["modified", "added", "deleted", "renamed", "copied", "conflicted", "untracked"],
  Diff: ["diffAdd", "diffRemove", "diffContext", "diffNoNewline"],
  "Tag scope": ["tagLocal", "tagRemote", "tagUnpushed", "tagLocalOnly"],
  "Operation status": ["success", "warning", "error", "info", "pending", "running", "done"],
  Spinner: ["spinnerFrames"],
  Toggle: ["checkboxOn", "checkboxOff"],
  Overflow: ["badgeOverflow"],
  Console: ["omittedLines"],
  "Graph lanes": ["graphLanes"],
  "Truncation and hints": ["ellipsis", "hintSeparator"],
};

/** Every documented icon name, flattened from the required groups. */
const REQUIRED_ICON_NAMES = Object.values(REQUIRED_ICON_GROUPS).flat();

describe("ICONS", () => {
  it("covers every documented group and key from architecture 6.1", () => {
    const names = new Set(Object.keys(ICONS));

    for (const [group, required] of Object.entries(REQUIRED_ICON_GROUPS)) {
      for (const name of required) {
        expect(names.has(name), `${group}: ${name}`).toBe(true);
      }
    }

    expect(REQUIRED_ICON_NAMES).toHaveLength(new Set(REQUIRED_ICON_NAMES).size);
    expect(REQUIRED_ICON_NAMES).toHaveLength(Object.keys(ICONS).length);
  });

  it("defines only printable ASCII strings", () => {
    for (const [name, value] of Object.entries(ICONS)) {
      if (typeof value === "string") {
        expect(value, name).toMatch(PRINTABLE_ASCII);
      } else {
        expect(value.length, name).toBeGreaterThan(0);

        for (const frame of value) {
          expect(frame, name).toMatch(PRINTABLE_ASCII);
        }
      }
    }
  });

  it("keeps every array-valued group non-empty and frozen", () => {
    for (const key of ["spinnerFrames", "graphLanes"] as const) {
      expect(ICONS[key].length).toBeGreaterThan(0);
      expect(Object.isFrozen(ICONS[key])).toBe(true);
    }
  });

  it("keeps the documented state marker values", () => {
    expect(ICONS.focus).toBe(">");
    expect(ICONS.selected).toBe(">");
    expect(ICONS.expanded).toBe("v");
    expect(ICONS.collapsed).toBe(">");
    expect(ICONS.currentBranch).toBe("*");
    expect(ICONS.missingUpstream).toBe("[?]");
    expect(ICONS.checkboxOn).toBe("[x]");
    expect(ICONS.checkboxOff).toBe("[ ]");
    expect(ICONS.pending).toBe("[ ]");
    expect(ICONS.running).toBe("[..]");
    expect(ICONS.done).toBe("[v]");
  });
});
