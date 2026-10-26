import { describe, expect, it } from "bun:test";
import { THEME_TOKEN_NAMES, THEME_TOKEN_TARGETS } from "@/domain/theme/theme.tokens";

describe("theme token targets", () => {
  it("lists each token exactly once", () => {
    const tokens = THEME_TOKEN_TARGETS.map((target) => target.token);

    expect(tokens).toEqual([...THEME_TOKEN_NAMES]);
    expect(new Set(tokens).size).toBe(THEME_TOKEN_NAMES.length);
  });

  it("documents a target, a prop, and a purpose for every token", () => {
    for (const target of THEME_TOKEN_TARGETS) {
      expect(target.target.length).toBeGreaterThan(0);
      expect(target.prop.length).toBeGreaterThan(0);
      expect(target.purpose.length).toBeGreaterThan(0);
    }
  });

  it("maps representative tokens to their documented OpenTUI props", () => {
    const props = new Map(THEME_TOKEN_TARGETS.map((target) => [target.token, target.prop]));

    expect(props.get("background")).toBe("backgroundColor");
    expect(props.get("focus")).toBe("focusedBorderColor");
    expect(props.get("text")).toBe("fg");
    expect(props.get("diffAdd")).toBe("addedSignColor");
    expect(props.get("diffAddBackground")).toBe("addedBg");
    expect(props.get("graph")).toBe("fg and backgroundColor per lane");
  });

  it("records the sidebar list-row surface exception on the selection target", () => {
    const targets = new Map(THEME_TOKEN_TARGETS.map((target) => [target.token, target]));

    expect(targets.get("selection")?.target).toContain("native select");
    expect(targets.get("selection")?.target).toContain("surface");
    expect(targets.get("surface")?.target).toContain("selected sidebar ListRow");
  });

  it("freezes the shared target list and every target", () => {
    expect(Object.isFrozen(THEME_TOKEN_TARGETS)).toBe(true);

    for (const target of THEME_TOKEN_TARGETS) {
      expect(Object.isFrozen(target), target.token).toBe(true);
      expect(Reflect.set(target, "prop", "fg")).toBe(false);
    }

    expect(Reflect.set(THEME_TOKEN_TARGETS, 0, "replaced")).toBe(false);
  });
});
