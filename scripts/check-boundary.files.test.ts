import { describe, expect, it } from "bun:test";
import path from "node:path";
import type ts from "typescript";
import { checkSourceFile } from "./check-boundary";
import { checkFileName, checkHexColors } from "./check-boundary.files";
import { type Diagnostic, parseSourceText, REPO_ROOT } from "./check-support";

/**
 * Parses inline source text as a repository file.
 *
 * @param relative - Repository-relative file path.
 * @param text - The source text.
 * @returns The parsed source file.
 */
function parse(relative: string, text: string): ts.SourceFile {
  return parseSourceText(path.join(REPO_ROOT, relative), text);
}

/**
 * Runs the file-name rule for inline source.
 *
 * @param relative - Repository-relative file path.
 * @param text - The source text.
 * @returns The file-name diagnostics.
 */
function fileNameErrors(relative: string, text: string): Diagnostic[] {
  const errors: Diagnostic[] = [];
  checkFileName(parse(relative, text), errors);

  return errors;
}

/**
 * Runs the hex-color rule for inline source.
 *
 * @param relative - Repository-relative file path.
 * @param text - The source text.
 * @returns The hex-color diagnostics.
 */
function hexColorErrors(relative: string, text: string): Diagnostic[] {
  const errors: Diagnostic[] = [];
  checkHexColors(parse(relative, text), errors);

  return errors;
}

/**
 * Runs every boundary rule for inline source.
 *
 * @param relative - Repository-relative file path.
 * @param text - The source text.
 * @returns The boundary diagnostics.
 */
function boundaryErrors(relative: string, text: string): Diagnostic[] {
  const errors: Diagnostic[] = [];
  checkSourceFile(parse(relative, text), errors);

  return errors;
}

/**
 * Joins diagnostic messages for a substring assertion.
 *
 * @param errors - The diagnostics.
 * @returns The joined messages.
 */
function messages(errors: readonly Diagnostic[]): string {
  return errors.map((error) => error.message).join("\n");
}

describe("checkHexColors", () => {
  it("flags a hex color outside the Catppuccin token module", () => {
    const errors = hexColorErrors("src/ui/probe.tsx", 'const accent = "#ff0000";');

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("hex color literals are allowed only");
  });

  it("allows hex colors in the Catppuccin token module", () => {
    const errors = hexColorErrors(
      "src/domain/theme/theme.catppuccin.ts",
      'export const red = "#f38ba8";',
    );

    expect(errors).toEqual([]);
  });
});

describe("checkFileName", () => {
  it("flags a barrel under src/ui", () => {
    const errors = fileNameErrors("src/ui/index.ts", 'export { Panel } from "./Panel";');

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("index barrels are forbidden");
  });

  it("allows the bootstrap entry point", () => {
    const errors = fileNameErrors("src/index.tsx", 'import { App } from "@/app/App";');

    expect(errors).toEqual([]);
  });

  it("flags a forbidden generic file name", () => {
    const errors = fileNameErrors("src/lib/utils.ts", "export const value = 1;");

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("file name 'utils.ts' is forbidden");
  });

  it("allows a concern-named file with the same suffix", () => {
    const errors = fileNameErrors("src/lib/git.utils.ts", "export const value = 1;");

    expect(errors).toEqual([]);
  });
});

describe("checkSourceFile", () => {
  it("runs the file-name and hex-color rules for one file", () => {
    const errors = boundaryErrors("src/ui/helpers.ts", 'export const accent = "#ff0000";');

    expect(errors).toHaveLength(2);
    expect(messages(errors)).toContain("file name 'helpers.ts' is forbidden");
    expect(messages(errors)).toContain("hex color literals are allowed only");
  });
});
