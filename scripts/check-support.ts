import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { Diagnostic } from "./check-support.types";

export type { Diagnostic } from "./check-support.types";

/** Absolute path of the repository root. */
export const REPO_ROOT = path.resolve(import.meta.dir, "..");

/** Absolute path of the enforced source directory. */
export const SRC_DIR = path.join(REPO_ROOT, "src");

/** Absolute path of the enforcement script directory. */
export const SCRIPTS_DIR = path.join(REPO_ROOT, "scripts");

/**
 * Lists every file beneath a directory, depth-first.
 *
 * @param directory - Absolute directory path.
 * @returns Absolute file paths in directory order.
 */
export function listFiles(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Converts an absolute path to a repository-relative POSIX path.
 *
 * @param file - Absolute file path.
 * @returns The repository-relative path, for example `src/lib/semver.ts`.
 */
export function toRepoPath(file: string): string {
  return path.relative(REPO_ROOT, file).split(path.sep).join("/");
}

/**
 * Reports whether a file is a script the checkers inspect.
 *
 * @param file - Absolute or repository-relative file path.
 * @returns `true` for `.ts`, `.tsx`, `.js`, and `.jsx` files.
 */
export function isSourceFile(file: string): boolean {
  return [".ts", ".tsx", ".js", ".jsx"].some((extension) => file.endsWith(extension));
}

/**
 * Reports whether a file is a colocated unit-test file.
 *
 * @param file - Absolute or repository-relative file path.
 * @returns `true` for `*.test.ts`, `*.test.tsx`, `*.test.js`, and `*.test.jsx`.
 */
export function isTestFile(file: string): boolean {
  const name = path.basename(file);

  return [".test.ts", ".test.tsx", ".test.js", ".test.jsx"].some((suffix) => name.endsWith(suffix));
}

/**
 * Selects the TypeScript script kind for a file extension.
 *
 * @param file - Absolute or repository-relative file path.
 * @returns The matching script kind, defaulting to TypeScript.
 */
function selectScriptKind(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) {
    return ts.ScriptKind.TSX;
  }

  if (file.endsWith(".jsx")) {
    return ts.ScriptKind.JSX;
  }

  if (file.endsWith(".js")) {
    return ts.ScriptKind.JS;
  }

  return ts.ScriptKind.TS;
}

/**
 * Parses TypeScript or JavaScript source text with the matching script kind.
 *
 * @param file - Absolute or repository-relative file path used for diagnostics.
 * @param text - The source text.
 * @returns The parsed source file.
 */
export function parseSourceText(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, selectScriptKind(file));
}

/**
 * Parses a TypeScript or JavaScript source file with the matching script kind.
 *
 * @param file - Absolute file path.
 * @returns The parsed source file.
 */
export function parseSourceFile(file: string): ts.SourceFile {
  return parseSourceText(file, readFileSync(file, "utf8"));
}

/**
 * Creates a diagnostic for a node.
 *
 * @param sourceFile - The source file containing the node.
 * @param node - The node that triggered the finding.
 * @param message - Human-readable explanation.
 * @returns The diagnostic with the node's line number.
 */
export function diagnosticAt(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
): Diagnostic {
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));

  return {
    file: toRepoPath(sourceFile.fileName),
    line: line + 1,
    message,
  };
}

/**
 * Creates a file-level diagnostic.
 *
 * @param file - Absolute or repository-relative file path.
 * @param message - Human-readable explanation.
 * @returns The diagnostic at line one.
 */
export function fileDiagnostic(file: string, message: string): Diagnostic {
  return {
    file: file.startsWith(REPO_ROOT) ? toRepoPath(file) : file,
    line: 1,
    message,
  };
}

/**
 * Reports whether a node has a JSDoc block directly attached.
 *
 * @param node - The declaration or statement to inspect.
 * @returns `true` when TypeScript associates a JSDoc block with the node.
 */
export function hasJSDocBlock(node: ts.Node): boolean {
  return ts.getJSDocCommentsAndTags(node).length > 0;
}

/**
 * Returns the repository-relative paths of script files under a directory.
 *
 * @param directory - Absolute directory to scan. Defaults to `src`.
 * @returns Every `.ts`, `.tsx`, `.js`, and `.jsx` file, including colocated tests.
 */
export function listSourceFiles(directory: string = SRC_DIR): string[] {
  return listFiles(directory).filter(isSourceFile).map(toRepoPath).sort();
}

/**
 * Prints a checker report and sets a failing exit code when there are errors.
 *
 * Warnings stay on standard output; errors go to standard error so CI annotations and logs read
 * the failing findings on the conventional stream. The exit code is unchanged either way.
 *
 * @param title - The checker title.
 * @param errors - Findings that fail the check.
 * @param warnings - Findings that only warn.
 */
export function report(title: string, errors: Diagnostic[], warnings: Diagnostic[] = []): void {
  const lines = [title];

  if (warnings.length > 0) {
    lines.push(`Warnings (${warnings.length}):`);

    for (const warning of warnings) {
      lines.push(`  ${warning.file}:${warning.line} ${warning.message}`);
    }
  }

  if (errors.length === 0 && warnings.length === 0) {
    lines.push("No issues.");
  } else if (errors.length === 0) {
    lines.push("No errors.");
  }

  console.log(lines.join("\n"));

  if (errors.length > 0) {
    const errorLines = [`Errors (${errors.length}):`];

    for (const error of errors) {
      errorLines.push(`  ${error.file}:${error.line} ${error.message}`);
    }

    console.error(errorLines.join("\n"));
    process.exitCode = 1;
  }
}
