import { describe, expect, it } from "bun:test";
import { formatBinding } from "@/domain/keymap/keymap.describe";
import { bindingKey, parseBinding } from "@/domain/keymap/keymap.parse";
import type { KeymapPlatform, ParsedBinding } from "@/domain/keymap/keymap.types";

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
