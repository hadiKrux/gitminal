import path from "node:path";
import ts from "typescript";
import {
  FORBIDDEN_FILE_NAMES,
  HEX_COLOR_PATTERN,
  THEME_COLORS_PATH,
} from "./check-boundary.constants";
import {
  type Diagnostic,
  diagnosticAt,
  fileDiagnostic,
  hasJSDocBlock,
  isTestFile,
  toRepoPath,
} from "./check-support";

/**
 * Flags barrels and generic utility file names.
 *
 * @param sourceFile - The parsed source file.
 * @param errors - Finding accumulator.
 */
export function checkFileName(sourceFile: ts.SourceFile, errors: Diagnostic[]): void {
  const relative = toRepoPath(sourceFile.fileName);
  const baseName = path.posix.basename(relative);

  if (isBarrelFile(baseName) && relative !== "src/index.tsx") {
    errors.push(fileDiagnostic(relative, "index barrels are forbidden"));
  }

  const stem = baseName.split(".")[0]?.toLowerCase() ?? "";

  if (FORBIDDEN_FILE_NAMES.has(stem)) {
    errors.push(
      fileDiagnostic(relative, `file name '${baseName}' is forbidden; name the concern instead`),
    );
  }
}

/**
 * Reports whether a file name is an index barrel.
 *
 * @param baseName - The file base name.
 * @returns `true` for `index.ts`, `index.tsx`, `index.js`, and `index.jsx`.
 */
function isBarrelFile(baseName: string): boolean {
  return ["index.ts", "index.tsx", "index.js", "index.jsx"].includes(baseName);
}

/**
 * Flags hex color literals outside the Catppuccin token module.
 *
 * @param sourceFile - The parsed source file.
 * @param errors - Finding accumulator.
 */
export function checkHexColors(sourceFile: ts.SourceFile, errors: Diagnostic[]): void {
  if (toRepoPath(sourceFile.fileName) === THEME_COLORS_PATH) {
    return;
  }

  const visit = (node: ts.Node): void => {
    const text = readStringText(node);

    if (text !== null && HEX_COLOR_PATTERN.test(text)) {
      errors.push(
        diagnosticAt(
          sourceFile,
          node,
          "hex color literals are allowed only in src/domain/theme/theme.catppuccin.ts",
        ),
      );
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
}

/**
 * Reads the text of a string or template literal node.
 *
 * @param node - The candidate node.
 * @returns The literal text, or `null` for other nodes.
 */
function readStringText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }

  if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
    return node.text;
  }

  return null;
}

/**
 * Requires JSDoc on top-level functions, class methods, and exported arrow functions.
 *
 * Colocated test files are exempt from this rule, matching the repository rule that documentation
 * and component-shape rules do not apply to tests.
 *
 * @param sourceFile - The parsed source file.
 * @param errors - Finding accumulator.
 */
export function checkJSDoc(sourceFile: ts.SourceFile, errors: Diagnostic[]): void {
  if (isTestFile(toRepoPath(sourceFile.fileName))) {
    return;
  }

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement)) {
      reportMissingJSDoc(sourceFile, statement, statement.name?.text ?? "function", errors);
    }

    if (ts.isClassDeclaration(statement)) {
      checkClassMethods(sourceFile, statement, errors);
    }

    if (ts.isVariableStatement(statement) && isExported(statement)) {
      checkExportedFunctions(sourceFile, statement, errors);
    }
  }
}

/**
 * Checks methods and constructors declared in a class.
 *
 * @param sourceFile - The parsed source file.
 * @param declaration - The class declaration.
 * @param errors - Finding accumulator.
 */
function checkClassMethods(
  sourceFile: ts.SourceFile,
  declaration: ts.ClassDeclaration,
  errors: Diagnostic[],
): void {
  for (const member of declaration.members) {
    if (
      ts.isMethodDeclaration(member) ||
      ts.isConstructorDeclaration(member) ||
      ts.isGetAccessorDeclaration(member) ||
      ts.isSetAccessorDeclaration(member)
    ) {
      reportMissingJSDoc(sourceFile, member, readMemberName(member), errors);
    }
  }
}

/**
 * Reads a readable member name for diagnostics.
 *
 * @param member - The class member.
 * @returns The member name, or `constructor`.
 */
function readMemberName(member: ts.ClassElement): string {
  if (ts.isConstructorDeclaration(member)) {
    return "constructor";
  }

  if (member.name && ts.isIdentifier(member.name)) {
    return member.name.text;
  }

  return "method";
}

/**
 * Checks exported arrow and function expressions assigned to variables.
 *
 * @param sourceFile - The parsed source file.
 * @param statement - The exported variable statement.
 * @param errors - Finding accumulator.
 */
function checkExportedFunctions(
  sourceFile: ts.SourceFile,
  statement: ts.VariableStatement,
  errors: Diagnostic[],
): void {
  for (const declaration of statement.declarationList.declarations) {
    if (
      declaration.initializer &&
      (ts.isArrowFunction(declaration.initializer) ||
        ts.isFunctionExpression(declaration.initializer))
    ) {
      const name = declaration.name.getText(sourceFile);
      const documented = hasJSDocBlock(statement) || hasJSDocBlock(declaration);

      if (!documented) {
        errors.push(diagnosticAt(sourceFile, statement, `missing JSDoc block for '${name}'`));
      }
    }
  }
}

/**
 * Reports a missing JSDoc block.
 *
 * @param sourceFile - The parsed source file.
 * @param node - The declaration to check.
 * @param name - A readable declaration name.
 * @param errors - Finding accumulator.
 */
function reportMissingJSDoc(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  name: string,
  errors: Diagnostic[],
): void {
  if (!hasJSDocBlock(node)) {
    errors.push(diagnosticAt(sourceFile, node, `missing JSDoc block for '${name}'`));
  }
}

/**
 * Reports whether a node has an `export` modifier.
 *
 * @param node - The candidate node.
 * @returns `true` when the node is exported.
 */
function isExported(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) {
    return false;
  }

  return (ts.getModifiers(node) ?? []).some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
  );
}
