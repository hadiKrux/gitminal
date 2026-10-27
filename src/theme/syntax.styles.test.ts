import { describe, expect, it } from "bun:test";
import { applyThemeCapability } from "@/domain/theme/theme.capability";
import { resolveTheme } from "@/domain/theme/theme.resolve";
import type { ThemeToken } from "@/domain/theme/theme.tokens";
import { SYNTAX_SCOPE_TOKENS } from "@/theme/syntax.constants";
import { buildSyntaxStyles } from "@/theme/syntax.styles";

/** Colors that belong to diff semantics and must never appear as a syntax foreground. */
const RESERVED_DIFF_TOKENS: ReadonlySet<string> = new Set([
  "diffAdd",
  "diffRemove",
  "diffAddBackground",
  "diffRemoveBackground",
  "success",
  "error",
]);

describe("syntax scope tokens", () => {
  it("maps every scope onto a real theme token", () => {
    const tokens = resolveTheme("catppuccin-mocha").tokens;

    for (const token of Object.values(SYNTAX_SCOPE_TOKENS)) {
      expect(Object.hasOwn(tokens, token), token).toBe(true);
    }
  });

  it("reserves green and red for added and removed diff lines", () => {
    for (const token of Object.values(SYNTAX_SCOPE_TOKENS)) {
      expect(RESERVED_DIFF_TOKENS.has(token), token).toBe(false);
    }
  });

  it("keeps the documented role assignments", () => {
    expect(SYNTAX_SCOPE_TOKENS.keyword).toBe("accent");
    expect(SYNTAX_SCOPE_TOKENS.type).toBe("branchRemote");
    expect(SYNTAX_SCOPE_TOKENS.function).toBe("info");
    expect(SYNTAX_SCOPE_TOKENS.string).toBe("tag");
    expect(SYNTAX_SCOPE_TOKENS.number).toBe("warning");
    expect(SYNTAX_SCOPE_TOKENS.comment).toBe("muted");
    expect(SYNTAX_SCOPE_TOKENS.punctuation).toBe("dim");
    expect(SYNTAX_SCOPE_TOKENS.default).toBe("text");
  });

  it("omits marker scopes that would override the capture they share a node with", () => {
    for (const scope of ["spell", "none", "embedded", "conceal"]) {
      expect(Object.hasOwn(SYNTAX_SCOPE_TOKENS, scope), scope).toBe(false);
    }
  });
});

describe("buildSyntaxStyles", () => {
  it("uses the resolved token color for every scope", () => {
    const tokens = resolveTheme("catppuccin-mocha").tokens;
    const styles = buildSyntaxStyles(tokens);
    const entries = Object.entries(SYNTAX_SCOPE_TOKENS) as [string, Exclude<ThemeToken, "graph">][];

    for (const [scope, token] of entries) {
      expect(styles[scope]?.fg).toBe(tokens[token]);
    }
  });

  it("follows the active theme flavor", () => {
    const mocha = resolveTheme("catppuccin-mocha").tokens;
    const latte = resolveTheme("catppuccin-latte").tokens;

    expect(mocha.accent).not.toBe(latte.accent);
    expect(buildSyntaxStyles(latte).keyword?.fg).toBe(latte.accent);
    expect(buildSyntaxStyles(mocha).keyword?.fg).toBe(mocha.accent);
  });

  it("collapses to text and muted colors when the terminal has no color", () => {
    const mono = applyThemeCapability(resolveTheme("catppuccin-mocha"), "monochrome");
    const styles = buildSyntaxStyles(mono.tokens);

    expect(styles.keyword?.fg).toBe(mono.tokens.text);
    expect(styles.string?.fg).toBe(mono.tokens.text);
    expect(styles.comment?.fg).toBe(mono.tokens.muted);
    expect(styles.punctuation?.fg).toBe(mono.tokens.dim);
  });

  it("keeps every role distinct in truecolor", () => {
    const styles = buildSyntaxStyles(resolveTheme("catppuccin-mocha").tokens);
    const colors = ["keyword", "type", "function", "string", "number", "comment", "punctuation"]
      .map((scope) => styles[scope]?.fg)
      .filter((color): color is string => typeof color === "string");

    expect(new Set(colors).size).toBe(colors.length);
  });
});
