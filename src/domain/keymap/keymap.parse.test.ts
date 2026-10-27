import { describe, expect, it } from "bun:test";
import {
  bindingKey,
  detectKeymapPlatform,
  lookupBindingKey,
  matchesBinding,
  parseBinding,
  parseBindingValues,
  readKeyEvent,
} from "@/domain/keymap/keymap.parse";
import type { KeyEventLike, ParsedBinding } from "@/domain/keymap/keymap.types";

/**
 * Builds the minimum key event shape the parser accepts.
 *
 * @param name - Base key name.
 * @param overrides - Modifier overrides.
 * @returns A key event for matching tests.
 */
function keyEvent(name: string, overrides: Partial<KeyEventLike> = {}): KeyEventLike {
  return {
    name,
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    sequence: name,
    ...overrides,
  };
}

/**
 * Parses a binding and fails the test when it is invalid.
 *
 * @param value - Binding text.
 * @param platform - Platform used to expand `mod`.
 * @returns The parsed binding.
 */
function parseValid(
  value: string,
  platform: "macos" | "windows" | "linux" = "linux",
): ParsedBinding {
  const parsed = parseBinding(value, platform);

  expect(parsed).not.toBeNull();

  return parsed as ParsedBinding;
}

describe("parseBinding", () => {
  it("normalizes modifier aliases and ignores modifier order", () => {
    expect(parseValid("control+option+p")).toMatchObject({ ctrl: true, alt: true, key: "p" });
    expect(parseValid("alt+ctrl+p")).toMatchObject({ ctrl: true, alt: true, key: "p" });
    expect(parseValid("command+p")).toMatchObject({ meta: true, key: "p" });
    expect(parseValid("meta+p")).toMatchObject({ meta: true, key: "p" });
    expect(parseValid("cmd+p")).toMatchObject({ meta: true, key: "p" });
    expect(parseValid("shift+p")).toMatchObject({ shift: true, key: "p" });
  });

  it("expands mod per platform", () => {
    expect(parseValid("mod+p", "macos")).toMatchObject({ meta: true, ctrl: false, key: "p" });
    expect(parseValid("mod+p", "windows")).toMatchObject({ ctrl: true, meta: false, key: "p" });
    expect(parseValid("mod+p", "linux")).toMatchObject({ ctrl: true, meta: false, key: "p" });
  });

  it("treats uppercase letters as shift plus the lowercase letter", () => {
    expect(parseValid("P")).toEqual({
      key: "p",
      ctrl: false,
      shift: true,
      alt: false,
      meta: false,
    });
    expect(parseValid("p")).toEqual({
      key: "p",
      ctrl: false,
      shift: false,
      alt: false,
      meta: false,
    });
    expect(parseValid("shift+P")).toMatchObject({ key: "p", shift: true });
  });

  it("accepts named keys, aliases, function keys, and backtick", () => {
    expect(parseValid("enter").key).toBe("enter");
    expect(parseValid("return").key).toBe("enter");
    expect(parseValid("escape").key).toBe("esc");
    expect(parseValid("backtick").key).toBe("`");
    expect(parseValid("space").key).toBe("space");
    expect(parseValid("pageup").key).toBe("pageup");
    expect(parseValid("f1").key).toBe("f1");
    expect(parseValid("f12").key).toBe("f12");
    expect(parseValid("shift+tab")).toMatchObject({ key: "tab", shift: true });
  });

  it("rejects unsupported modifiers, keys, and empty segments", () => {
    const invalid = ["hyper+p", "f13", "ctrl+nope", "ctrl+", "", "+", "ctrl++", " "];

    for (const value of invalid) {
      expect(parseBinding(value, "linux")).toBeNull();
    }
  });

  it("requires the named space key because a literal space is trimmed", () => {
    expect(parseBinding(" ", "linux")).toBeNull();
    expect(parseBinding("ctrl+ ", "linux")).toBeNull();
    expect(parseValid("space")).toEqual({
      key: "space",
      ctrl: false,
      shift: false,
      alt: false,
      meta: false,
    });
  });

  it("keeps enter and Ctrl/Cmd+Enter distinct", () => {
    const enter = parseValid("enter");
    const submit = parseValid("ctrl+enter");

    expect(lookupBindingKey(enter)).toBe("enter");
    expect(lookupBindingKey(submit)).toBe("ctrl+enter");
    expect(lookupBindingKey(enter)).not.toBe(lookupBindingKey(submit));
  });
});

describe("parseBindingValues", () => {
  it("drops duplicate lookup keys and reports invalid values", () => {
    const result = parseBindingValues(["ctrl+p", "control+p", "p", "P", "nope"], "linux");

    expect(result.bindings).toHaveLength(3);
    expect(result.bindings.map(bindingKey)).toEqual(["ctrl+p", "p", "shift+p"]);
    expect(result.invalid).toEqual(["nope"]);
  });
});

describe("binding formatting and matching", () => {
  it("normalizes key events into lookup tokens", () => {
    expect(readKeyEvent(keyEvent("P", { shift: true }))).toEqual({
      key: "p",
      ctrl: false,
      shift: true,
      alt: false,
      meta: false,
    });
    expect(readKeyEvent(keyEvent("escape"))).toMatchObject({ key: "esc" });
    expect(readKeyEvent(keyEvent("c", { ctrl: true }))).toMatchObject({ key: "c", ctrl: true });
  });

  it("matches modifiers and shift-sensitive keys", () => {
    const push = parseValid("P");
    const tab = parseValid("tab");
    const previous = parseValid("shift+tab");

    expect(matchesBinding(push, keyEvent("P", { shift: true }))).toBe(true);
    expect(matchesBinding(push, keyEvent("p"))).toBe(false);
    expect(matchesBinding(tab, keyEvent("tab"))).toBe(true);
    expect(matchesBinding(tab, keyEvent("tab", { shift: true }))).toBe(false);
    expect(matchesBinding(previous, keyEvent("tab", { shift: true }))).toBe(true);
  });

  it("treats a kitty Alt chord as Alt, not Meta, when both flags are set", () => {
    const options = parseValid("alt+.");

    expect(matchesBinding(options, keyEvent(".", { option: true, meta: true }))).toBe(true);
    expect(readKeyEvent(keyEvent(".", { option: true, meta: true }))).toMatchObject({
      alt: true,
      meta: false,
    });
    expect(readKeyEvent(keyEvent(".", { meta: true }))).toMatchObject({ alt: false, meta: true });
  });

  it("ignores shift for symbols and digits", () => {
    const help = parseValid("?");

    expect(matchesBinding(help, keyEvent("?", { shift: true }))).toBe(true);
    expect(matchesBinding(help, keyEvent("?"))).toBe(true);
  });

  it("matches Ctrl+C exactly", () => {
    const quit = parseValid("ctrl+c");

    expect(matchesBinding(quit, keyEvent("c", { ctrl: true }))).toBe(true);
    expect(matchesBinding(quit, keyEvent("c"))).toBe(false);
  });
});

describe("detectKeymapPlatform", () => {
  it("detects WSL only on Linux with a nonempty standard marker", () => {
    for (const environment of [
      { WSL_DISTRO_NAME: "Ubuntu" },
      { WSL_INTEROP: "/run/WSL/123_interop" },
    ]) {
      expect(detectKeymapPlatform("linux", environment)).toBe("wsl");
      expect(detectKeymapPlatform("darwin", environment)).toBe("macos");
      expect(detectKeymapPlatform("win32", environment)).toBe("windows");
    }

    expect(detectKeymapPlatform("linux", { WSL_DISTRO_NAME: "", WSL_INTEROP: "" })).toBe("linux");
  });

  it("maps Node platform names to keymap platforms", () => {
    expect(detectKeymapPlatform("darwin")).toBe("macos");
    expect(detectKeymapPlatform("win32")).toBe("windows");
    expect(detectKeymapPlatform("linux", {})).toBe("linux");
    expect(detectKeymapPlatform("freebsd")).toBe("linux");
  });
});
