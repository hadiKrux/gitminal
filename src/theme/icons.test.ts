import { describe, expect, it } from "bun:test";
import { ICONS, type IconName } from "@/theme/icons";

/** Matches printable ASCII, space through tilde. */
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;

/**
 * The only icon names allowed to hold a non-ASCII value, with the required code point.
 *
 * Architecture 6.1 rule 2 sanctions the push and pull arrows, which are in WGL4 and CP437, and the
 * success check mark, which is in every mainstream monospace font. All three are East Asian
 * Ambiguous, so both OpenTUI width methods measure them as one cell. Every other value stays
 * printable ASCII. The code points are written numerically so no source file outside the catalog
 * needs a non-ASCII literal.
 */
const PICTOGRAPH_ICON_EXCEPTIONS: Readonly<Partial<Record<IconName, number>>> = {
  push: 0x2191,
  pull: 0x2193,
  success: 0x2713,
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
  "Tag scope": ["tagLocal", "tagRemote", "tagUnpushed", "tagLocalOnly"],
  "Remote actions": ["push", "pull"],
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
  "Graph lanes": ["graphLanes"],
  "Truncation and hints": ["ellipsis", "hintSeparator"],
  Theme: ["swatch"],
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

  it("defines printable ASCII strings apart from the documented pictographs", () => {
    for (const [name, value] of Object.entries(ICONS)) {
      const pictograph = PICTOGRAPH_ICON_EXCEPTIONS[name as IconName];

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

  it("keeps the pictograph exception to one cell and to the documented names only", () => {
    for (const [name, pictograph] of Object.entries(PICTOGRAPH_ICON_EXCEPTIONS)) {
      const value = ICONS[name as IconName] as string;

      // One BMP code point is one UTF-16 code unit, and both width methods give it one cell.
      expect(value.length, name).toBe(1);
      expect(value.codePointAt(0), name).toBe(pictograph);
    }

    const nonAsciiNames = Object.entries(ICONS)
      .filter(([, value]) => typeof value === "string" && !PRINTABLE_ASCII.test(value))
      .map(([name]) => name);

    expect(nonAsciiNames.sort()).toEqual(Object.keys(PICTOGRAPH_ICON_EXCEPTIONS).sort());
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
    expect(ICONS.push.codePointAt(0)).toBe(PICTOGRAPH_ICON_EXCEPTIONS.push);
    expect(ICONS.pull.codePointAt(0)).toBe(PICTOGRAPH_ICON_EXCEPTIONS.pull);
    expect(ICONS.success.codePointAt(0)).toBe(PICTOGRAPH_ICON_EXCEPTIONS.success);
  });
});
