import { describe, expect, it } from "bun:test";
import { ICONS, type IconName } from "@/theme/icons";

/** Matches printable ASCII, space through tilde. */
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;

/**
 * The only icon names allowed to hold a non-ASCII value, with the required code point.
 *
 * Architecture 6.1 rule 2 sanctions two groups. The pictographs are the push, pull, and tag-unpushed
 * arrows and the expanded triangle, which are in WGL4 and CP437, and the collapsed triangle and
 * success check mark, which are in every mainstream monospace font. The commit graph group is the
 * pair of commit symbols plus the box-drawing block that draws its lines and corners. The plain
 * lines and tees are in CP437 and WGL4, while the arc corners, half-lines, and merge symbol are not.
 * Every value in both groups is East Asian Ambiguous, so both OpenTUI width methods measure it as
 * one cell. Every other value stays printable ASCII. The code points are
 * written numerically so no source file outside the catalog needs a non-ASCII literal.
 */
const NON_ASCII_ICON_EXCEPTIONS: Readonly<Partial<Record<IconName, number>>> = {
  push: 0x2191,
  pull: 0x2193,
  success: 0x2713,
  tagUnpushed: 0x2191,
  expanded: 0x25bc,
  collapsed: 0x25b6,
  graphCommit: 0x25cb,
  graphMerge: 0x25ce,
  graphVertical: 0x2502,
  graphHorizontal: 0x2500,
  graphUpLeft: 0x256f,
  graphUpRight: 0x2570,
  graphDownLeft: 0x256e,
  graphDownRight: 0x256d,
  graphTeeUp: 0x2534,
  graphTeeDown: 0x252c,
  graphEndUp: 0x2575,
  graphEndDown: 0x2577,
  graphEndRight: 0x2576,
  graphSharpUpLeft: 0x2518,
  graphSharpUpRight: 0x2514,
  graphSharpDownLeft: 0x2510,
  graphSharpDownRight: 0x250c,
};

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
  "Tag scope": [
    "tagScopeOpen",
    "tagScopeClose",
    "tagScopeAbsent",
    "tagLocal",
    "tagRemote",
    "tagUnpushed",
    "tagUnknown",
  ],
  "Remote actions": ["push", "pull", "remoteLocalTracker"],
  "Operation status": [
    "success",
    "warning",
    "warningMarker",
    "error",
    "info",
    "pending",
    "running",
    "done",
  ],
  Spinner: ["spinnerFrames"],
  Toggle: ["checkboxOn", "checkboxOff"],
  Overflow: ["badgeOverflow"],
  Console: ["omittedLines"],
  "Graph lanes": [
    "graphCommit",
    "graphMerge",
    "graphVertical",
    "graphHorizontal",
    "graphUpLeft",
    "graphUpRight",
    "graphDownLeft",
    "graphDownRight",
    "graphTeeUp",
    "graphTeeDown",
    "graphEndUp",
    "graphEndDown",
    "graphEndRight",
    "graphSharpUpLeft",
    "graphSharpUpRight",
    "graphSharpDownLeft",
    "graphSharpDownRight",
    "graphMergeSharp",
  ],
  "Truncation and hints": ["ellipsis", "hintSeparator"],
  Theme: ["swatch"],
};

/** Every documented icon name, flattened from the required groups. */
const REQUIRED_ICON_NAMES = Object.values(REQUIRED_ICON_GROUPS).flat();

describe("ICONS", () => {
  it("defines the reusable local-upstream-tracker marker", () => {
    expect(ICONS.remoteLocalTracker).toBe("[L]");
  });

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

  it("defines printable ASCII strings apart from the documented non-ASCII icons", () => {
    for (const [name, value] of Object.entries(ICONS)) {
      const pictograph = NON_ASCII_ICON_EXCEPTIONS[name as IconName];

      if (pictograph !== undefined) {
        expect(typeof value, name).toBe("string");
        expect((value as string).codePointAt(0), name).toBe(pictograph);
        continue;
      }

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

  it("keeps every non-ASCII exception to one cell and to the documented names only", () => {
    for (const [name, pictograph] of Object.entries(NON_ASCII_ICON_EXCEPTIONS)) {
      const value = ICONS[name as IconName] as string;

      // One BMP code point is one UTF-16 code unit, and both width methods give it one cell.
      expect(value.length, name).toBe(1);
      expect(value.codePointAt(0), name).toBe(pictograph);
    }

    const nonAsciiNames = Object.entries(ICONS)
      .filter(([, value]) => typeof value === "string" && !PRINTABLE_ASCII.test(value))
      .map(([name]) => name);

    expect(nonAsciiNames.sort()).toEqual(Object.keys(NON_ASCII_ICON_EXCEPTIONS).sort());
  });

  it("keeps every array-valued group non-empty and frozen", () => {
    for (const key of ["spinnerFrames"] as const) {
      expect(ICONS[key].length).toBeGreaterThan(0);
      expect(Object.isFrozen(ICONS[key])).toBe(true);
    }
  });

  it("keeps the documented state marker values", () => {
    expect(ICONS.focus).toBe(">");
    expect(ICONS.selected).toBe(">");
    expect(ICONS.expanded.codePointAt(0)).toBe(NON_ASCII_ICON_EXCEPTIONS.expanded);
    expect(ICONS.collapsed.codePointAt(0)).toBe(NON_ASCII_ICON_EXCEPTIONS.collapsed);
    expect(ICONS.currentBranch).toBe("*");
    expect(ICONS.missingUpstream).toBe("[?]");
    expect(ICONS.checkboxOn).toBe("[x]");
    expect(ICONS.checkboxOff).toBe("[ ]");
    expect(ICONS.pending).toBe("[ ]");
    expect(ICONS.running).toBe("[..]");
    expect(ICONS.done).toBe("[v]");
    expect(ICONS.push.codePointAt(0)).toBe(NON_ASCII_ICON_EXCEPTIONS.push);
    expect(ICONS.pull.codePointAt(0)).toBe(NON_ASCII_ICON_EXCEPTIONS.pull);
    expect(ICONS.success.codePointAt(0)).toBe(NON_ASCII_ICON_EXCEPTIONS.success);
    expect(ICONS.tagUnpushed.codePointAt(0)).toBe(NON_ASCII_ICON_EXCEPTIONS.tagUnpushed);
  });
});
