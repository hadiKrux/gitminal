import { describe, expect, it } from "bun:test";
import path from "node:path";
import { checkFile, isGlyphExempt } from "./check-glyph";
import { type Diagnostic, parseSourceText, REPO_ROOT } from "./check-support";

/**
 * Parses inline source text as a repository file.
 *
 * @param relative - Repository-relative file path.
 * @param text - The source text.
 * @returns The parsed source file.
 */
function parse(relative: string, text: string): ReturnType<typeof parseSourceText> {
  return parseSourceText(path.join(REPO_ROOT, relative), text);
}

/**
 * Runs the glyph rule for inline source.
 *
 * @param relative - Repository-relative file path.
 * @param text - The source text.
 * @returns The glyph diagnostics.
 */
function glyphErrors(relative: string, text: string): Diagnostic[] {
  const errors: Diagnostic[] = [];
  checkFile(parse(relative, text), errors);

  return errors;
}

describe("checkFile", () => {
  it("flags a non-ASCII literal outside the icon catalog", () => {
    const arrow = String.fromCodePoint(0x2192);
    const errors = glyphErrors("src/lib/probe.ts", `const marker = "${arrow}";`);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("non-ASCII glyph literal");
  });

  it("allows printable ASCII literals", () => {
    const errors = glyphErrors("src/lib/probe.ts", 'const marker = ">";');

    expect(errors).toEqual([]);
  });

  it("scans .js and .jsx files", () => {
    const arrow = String.fromCodePoint(0x2192);
    const js = glyphErrors("src/lib/probe.js", `const marker = "${arrow}";`);
    const jsx = glyphErrors("src/features/probe.jsx", `<text>${arrow}</text>`);

    expect(js).toHaveLength(1);
    expect(jsx).toHaveLength(1);
  });
});

describe("isGlyphExempt", () => {
  it("allows only the icon catalog", () => {
    expect(isGlyphExempt("src/theme/icons.ts")).toBe(true);
    expect(isGlyphExempt("src/theme/icons.js")).toBe(false);
    expect(isGlyphExempt("src/lib/probe.ts")).toBe(false);
  });
});
