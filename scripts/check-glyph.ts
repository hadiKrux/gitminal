import path from "node:path";
import ts from "typescript";
import {
  type Diagnostic,
  diagnosticAt,
  listSourceFiles,
  parseSourceFile,
  REPO_ROOT,
  report,
} from "./check-support";

/** Repository path of the only module allowed to define reusable glyphs. */
const ICONS_PATH = "src/theme/icons.ts";

/** Highest codepoint allowed in source literals. */
const ASCII_MAX = 0x7f;

/**
 * Runs the glyph checker.
 */
export function main(): void {
  const errors: Diagnostic[] = [];

  for (const file of listSourceFiles()) {
    if (isGlyphExempt(file)) {
      continue;
    }

    checkFile(parseSourceFile(path.join(REPO_ROOT, file)), errors);
  }

  report("Glyph check", errors);
}

/**
 * Reports whether a file is allowed to define non-ASCII glyph literals.
 *
 * @param file - The repository-relative file path.
 * @returns `true` for the icon catalog.
 */
export function isGlyphExempt(file: string): boolean {
  return file === ICONS_PATH;
}

/**
 * Flags non-ASCII codepoints in string, template, and JSX text literals.
 *
 * @param sourceFile - The parsed source file.
 * @param errors - Finding accumulator.
 */
export function checkFile(sourceFile: ts.SourceFile, errors: Diagnostic[]): void {
  const visit = (node: ts.Node): void => {
    const text = readTextLiteral(node);

    if (text !== null && hasNonAscii(text)) {
      errors.push(
        diagnosticAt(
          sourceFile,
          node,
          "non-ASCII glyph literal; move reusable glyphs to src/theme/icons.ts",
        ),
      );
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
}

/**
 * Reads the text of a string, template, or JSX text node.
 *
 * @param node - The candidate node.
 * @returns The literal text, or `null` for other nodes.
 */
function readTextLiteral(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }

  if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
    return node.text;
  }

  if (ts.isJsxText(node)) {
    return node.text;
  }

  return null;
}

/**
 * Reports whether any codepoint is outside printable ASCII.
 *
 * @param text - The literal text to inspect.
 * @returns `true` when a codepoint is above `0x7f`.
 */
function hasNonAscii(text: string): boolean {
  for (const character of text) {
    if ((character.codePointAt(0) ?? 0) > ASCII_MAX) {
      return true;
    }
  }

  return false;
}

if (import.meta.main) {
  main();
}
