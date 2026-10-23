import path from "node:path";
import type ts from "typescript";
import { checkFileName, checkHexColors, checkJSDoc } from "./check-boundary.files";
import { checkImports } from "./check-boundary.imports";
import { checkRawKeys } from "./check-boundary.keys";
import { checkSpawnAndNetwork } from "./check-boundary.process";
import {
  type Diagnostic,
  listSourceFiles,
  parseSourceFile,
  REPO_ROOT,
  report,
} from "./check-support";

export { checkImports, collectImports, resolveImportTarget } from "./check-boundary.imports";
export { checkRawKeys } from "./check-boundary.keys";
export { checkSpawnAndNetwork } from "./check-boundary.process";
export type { ImportReference } from "./check-boundary.types";

/**
 * Runs the dependency-boundary checker.
 */
export function main(): void {
  const errors: Diagnostic[] = [];

  for (const file of listSourceFiles()) {
    checkSourceFile(parseSourceFile(path.join(REPO_ROOT, file)), errors);
  }

  report("Boundary check", errors);
}

/**
 * Runs every boundary rule for one parsed source file.
 *
 * @param sourceFile - The parsed source file.
 * @param errors - Finding accumulator.
 */
export function checkSourceFile(sourceFile: ts.SourceFile, errors: Diagnostic[]): void {
  checkFileName(sourceFile, errors);
  checkImports(sourceFile, errors);
  checkRawKeys(sourceFile, errors);
  checkSpawnAndNetwork(sourceFile, errors);
  checkHexColors(sourceFile, errors);
  checkJSDoc(sourceFile, errors);
}

if (import.meta.main) {
  main();
}
