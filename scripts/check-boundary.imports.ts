import path from "node:path";
import ts from "typescript";
import {
  BUILTIN_ALLOWLIST_BY_PATH,
  CONFIG_BUILTIN_ALLOWLIST,
  CONFIG_MODULE_PREFIX,
  FEATURE_APP_HOOKS_PREFIX,
  FEATURE_APP_PROVIDERS_PREFIX,
  FEATURE_SHARED_PREFIXES,
  TEST_RUNNER_SPECIFIERS,
  UI_PACKAGE_PATTERN,
} from "./check-boundary.constants";
import type { ImportLayerContext, ImportReference } from "./check-boundary.types";
import { type Diagnostic, diagnosticAt, isTestFile, toRepoPath } from "./check-support";

/**
 * Collects static imports, re-exports, dynamic imports, `require` calls, and
 * `import x = require(...)` declarations.
 *
 * @param sourceFile - The parsed source file.
 * @returns Every module reference found in the file.
 */
export function collectImports(sourceFile: ts.SourceFile): ImportReference[] {
  const references: ImportReference[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      references.push({ specifier: node.moduleSpecifier.text, node });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      references.push({ specifier: node.moduleSpecifier.text, node });
    } else if (ts.isImportEqualsDeclaration(node)) {
      addImportEqualsReference(node, references);
    } else if (ts.isCallExpression(node)) {
      addCallReference(node, references);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return references;
}

/**
 * Adds a reference from an `import x = require("...")` declaration.
 *
 * Only the external-module form is a module reference; an entity-name reference such as
 * `import x = ns.y` points inside the file and is ignored.
 *
 * @param node - The import-equals declaration.
 * @param references - Reference accumulator.
 */
function addImportEqualsReference(
  node: ts.ImportEqualsDeclaration,
  references: ImportReference[],
): void {
  const moduleReference = node.moduleReference;

  if (
    !ts.isExternalModuleReference(moduleReference) ||
    !ts.isStringLiteralLike(moduleReference.expression)
  ) {
    return;
  }

  references.push({ specifier: moduleReference.expression.text, node });
}

/**
 * Adds a dynamic import or `require` reference from a call expression.
 *
 * String literals and template literals without substitutions are collected.
 *
 * @param node - The call expression.
 * @param references - Reference accumulator.
 */
function addCallReference(node: ts.CallExpression, references: ImportReference[]): void {
  const argument = node.arguments[0];

  if (!argument || !ts.isStringLiteralLike(argument)) {
    return;
  }

  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    references.push({ specifier: argument.text, node });
  }

  if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
    references.push({ specifier: argument.text, node });
  }
}

/**
 * Resolves an import specifier to a repository-relative source path when possible.
 *
 * An `@/` alias is normalized before the layer rules run, so a traversal such as
 * `@/lib/../app/App` resolves to `src/app/App` and is checked as an app import. A target that
 * escapes `src/` resolves to `null` and is always rejected.
 *
 * @param file - The importing file as a POSIX repository path.
 * @param specifier - The raw module specifier.
 * @returns A `src/...` path for local imports, or `null` for packages and out-of-tree paths.
 */
export function resolveImportTarget(file: string, specifier: string): string | null {
  if (specifier.startsWith("@/")) {
    return readAliasTarget(specifier);
  }

  if (specifier.startsWith(".")) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));

    return target.startsWith("src/") ? target : null;
  }

  return null;
}

/**
 * Normalizes an `@/` alias into a `src/...` path.
 *
 * @param specifier - The raw alias specifier.
 * @returns The normalized source path, or `null` when it escapes `src/`.
 */
function readAliasTarget(specifier: string): string | null {
  const target = path.posix.normalize(`src/${specifier.slice(2)}`).replace(/\/+$/, "");
  const escaped = target.split("/").includes("..");

  return target.startsWith("src/") && !escaped ? target : null;
}

/**
 * Reports whether a specifier points inside the source tree.
 *
 * @param specifier - The raw module specifier.
 * @returns `true` for `@/` aliases and relative paths.
 */
function isLocalSpecifier(specifier: string): boolean {
  return specifier.startsWith("@/") || specifier.startsWith(".");
}

/**
 * Builds the layer facts for one source file.
 *
 * @param sourceFile - The parsed source file.
 * @returns The layer context.
 */
function createLayerContext(sourceFile: ts.SourceFile): ImportLayerContext {
  const relative = toRepoPath(sourceFile.fileName);

  return {
    sourceFile,
    relative,
    isDomain: relative.startsWith("src/domain/"),
    isLib: relative.startsWith("src/lib/"),
    isUi: relative.startsWith("src/ui/"),
    isTheme: relative.startsWith("src/theme/"),
    featureName: readFeatureName(relative),
  };
}

/**
 * Reads the imports and enforces the boundary rules for a file.
 *
 * @param sourceFile - The parsed source file.
 * @param errors - Finding accumulator.
 */
export function checkImports(sourceFile: ts.SourceFile, errors: Diagnostic[]): void {
  const context = createLayerContext(sourceFile);

  for (const reference of collectImports(sourceFile)) {
    checkImportReference(context, reference, errors);
  }
}

/**
 * Applies every layer rule to one import reference.
 *
 * @param context - Layer facts for the importing file.
 * @param reference - The import reference under test.
 * @param errors - Finding accumulator.
 */
function checkImportReference(
  context: ImportLayerContext,
  reference: ImportReference,
  errors: Diagnostic[],
): void {
  const target = resolveImportTarget(context.relative, reference.specifier);
  const external = !isLocalSpecifier(reference.specifier);

  if (isAllowedTestImport(context.relative, reference.specifier, target)) {
    return;
  }

  if (checkTestOnlyImport(context, reference, target, errors)) {
    return;
  }

  checkDomainImport(context, reference, target, external, errors);
  checkLibImport(context, reference, target, external, errors);
  checkUiImport(context, reference, target, external, errors);
  checkThemeImport(context, reference, target, external, errors);
  checkFeatureImport(context, reference, target, external, errors);
}

/**
 * Rejects a test-only import from a production module that has no layer rule of its own.
 *
 * The test-only specifiers are the test runners (`bun:test`, `node:test`) and `src/test` or any
 * module under `src/test/`. The domain, lib, ui, feature, and theme rules already reject both with
 * their own layer message because neither is a valid target for those layers. The app layer and the
 * bootstrap entry are otherwise unconstrained, so they are the gap this guard closes. A colocated
 * test file and a module under `src/test/` may still import the test runner and the shared fixture.
 *
 * @param context - Layer facts for the importing file.
 * @param reference - The import reference under test.
 * @param target - The resolved repository-relative target, or `null` for packages.
 * @param errors - Finding accumulator.
 * @returns `true` when a diagnostic was reported.
 */
function checkTestOnlyImport(
  context: ImportLayerContext,
  reference: ImportReference,
  target: string | null,
  errors: Diagnostic[],
): boolean {
  const isTestOnlySpecifier =
    TEST_RUNNER_SPECIFIERS.has(reference.specifier) || isTestOnlyTarget(target);

  if (!isTestOnlySpecifier) {
    return false;
  }

  if (isTestFile(context.relative) || context.relative.startsWith("src/test/")) {
    return false;
  }

  if (hasLayerImportRule(context)) {
    return false;
  }

  errors.push(
    diagnosticAt(
      context.sourceFile,
      reference.node,
      `production modules must not import test-only modules ('${reference.specifier}')`,
    ),
  );

  return true;
}

/**
 * Reports whether a layer rule applies to the importing file.
 *
 * @param context - Layer facts for the importing file.
 * @returns `true` for domain, lib, ui, theme, and feature files.
 */
function hasLayerImportRule(context: ImportLayerContext): boolean {
  return (
    Boolean(context.featureName) ||
    context.isDomain ||
    context.isLib ||
    context.isUi ||
    context.isTheme
  );
}

/**
 * Reports whether a colocated test file may use a test-only import.
 *
 * Test files may import a test runner and the shared fixture under `src/test/**`. External
 * package imports still follow the layer rule.
 *
 * @param relative - The repository-relative file path.
 * @param specifier - The raw module specifier.
 * @param target - The resolved repository-relative target, or `null` for packages.
 * @returns `true` for a test-runner import and a `src/test` import from a colocated test file.
 */
function isAllowedTestImport(relative: string, specifier: string, target: string | null): boolean {
  if (!isTestFile(relative)) {
    return false;
  }

  return TEST_RUNNER_SPECIFIERS.has(specifier) || isTestOnlyTarget(target);
}

/**
 * Reports whether a resolved target points at the test-only tree.
 *
 * The exact `src/test` directory is test-only as well as every module beneath it.
 *
 * @param target - The resolved repository-relative target, or `null` for packages.
 * @returns `true` for `src/test` and `src/test/**`.
 */
function isTestOnlyTarget(target: string | null): boolean {
  return target === "src/test" || Boolean(target?.startsWith("src/test/"));
}

/**
 * Flags domain imports outside domain and lib, external packages, and unlisted builtins.
 *
 * @param context - Layer facts for the importing file.
 * @param reference - The import reference under test.
 * @param target - The resolved repository-relative target, or `null` for packages.
 * @param external - True when the specifier is an external package or builtin.
 * @param errors - Finding accumulator.
 */
function checkDomainImport(
  context: ImportLayerContext,
  reference: ImportReference,
  target: string | null,
  external: boolean,
  errors: Diagnostic[],
): void {
  if (!context.isDomain) {
    return;
  }

  if (external) {
    if (!isAllowedBuiltin(context.relative, reference.specifier)) {
      errors.push(
        diagnosticAt(
          context.sourceFile,
          reference.node,
          readExternalImportMessage("domain", reference.specifier),
        ),
      );
    }

    return;
  }

  if (!target || !isAllowedDomainTarget(target)) {
    errors.push(
      diagnosticAt(
        context.sourceFile,
        reference.node,
        `domain may import only domain and lib modules ('${reference.specifier}')`,
      ),
    );
  }
}

/**
 * Flags lib imports outside lib, external packages, and unlisted builtins.
 *
 * @param context - Layer facts for the importing file.
 * @param reference - The import reference under test.
 * @param target - The resolved repository-relative target, or `null` for packages.
 * @param external - True when the specifier is an external package or builtin.
 * @param errors - Finding accumulator.
 */
function checkLibImport(
  context: ImportLayerContext,
  reference: ImportReference,
  target: string | null,
  external: boolean,
  errors: Diagnostic[],
): void {
  if (!context.isLib) {
    return;
  }

  if (external) {
    if (!isAllowedBuiltin(context.relative, reference.specifier)) {
      errors.push(
        diagnosticAt(
          context.sourceFile,
          reference.node,
          readExternalImportMessage("lib", reference.specifier),
        ),
      );
    }

    return;
  }

  if (!target?.startsWith("src/lib/")) {
    errors.push(
      diagnosticAt(
        context.sourceFile,
        reference.node,
        `lib may import only lib modules ('${reference.specifier}')`,
      ),
    );
  }
}

/**
 * Flags UI imports outside React, OpenTUI, UI, lib, and theme.
 *
 * @param context - Layer facts for the importing file.
 * @param reference - The import reference under test.
 * @param target - The resolved repository-relative target, or `null` for packages.
 * @param external - True when the specifier is an external package or builtin.
 * @param errors - Finding accumulator.
 */
function checkUiImport(
  context: ImportLayerContext,
  reference: ImportReference,
  target: string | null,
  external: boolean,
  errors: Diagnostic[],
): void {
  if (!context.isUi) {
    return;
  }

  if (external && !UI_PACKAGE_PATTERN.test(reference.specifier)) {
    errors.push(
      diagnosticAt(
        context.sourceFile,
        reference.node,
        `ui may import only React, OpenTUI, lib, and theme modules ('${reference.specifier}')`,
      ),
    );

    return;
  }

  if (!external && (!target || !isAllowedUiTarget(target))) {
    errors.push(
      diagnosticAt(
        context.sourceFile,
        reference.node,
        `ui may import only React, OpenTUI, lib, and theme modules, or another ui primitive ('${reference.specifier}')`,
      ),
    );
  }
}

/**
 * Flags theme imports outside React, OpenTUI, lib, theme, and the domain theme modules.
 *
 * @param context - Layer facts for the importing file.
 * @param reference - The import reference under test.
 * @param target - The resolved repository-relative target, or `null` for packages.
 * @param external - True when the specifier is an external package or builtin.
 * @param errors - Finding accumulator.
 */
function checkThemeImport(
  context: ImportLayerContext,
  reference: ImportReference,
  target: string | null,
  external: boolean,
  errors: Diagnostic[],
): void {
  if (!context.isTheme) {
    return;
  }

  if (external) {
    if (!UI_PACKAGE_PATTERN.test(reference.specifier)) {
      errors.push(
        diagnosticAt(
          context.sourceFile,
          reference.node,
          `theme may import only React, OpenTUI, lib, theme, and domain theme modules ('${reference.specifier}')`,
        ),
      );
    }

    return;
  }

  if (!isAllowedThemeTarget(target)) {
    errors.push(
      diagnosticAt(
        context.sourceFile,
        reference.node,
        `theme may import only React, OpenTUI, lib, theme, and domain theme modules ('${reference.specifier}')`,
      ),
    );
  }
}

/**
 * Flags feature imports outside the documented feature edges.
 *
 * @param context - Layer facts for the importing file.
 * @param reference - The import reference under test.
 * @param target - The resolved repository-relative target, or `null` for packages.
 * @param external - True when the specifier is an external package or builtin.
 * @param errors - Finding accumulator.
 */
function checkFeatureImport(
  context: ImportLayerContext,
  reference: ImportReference,
  target: string | null,
  external: boolean,
  errors: Diagnostic[],
): void {
  const featureName = context.featureName;

  if (!featureName) {
    return;
  }

  if (isAllowedFeatureImport(featureName, reference.specifier, target, external)) {
    return;
  }

  errors.push(
    diagnosticAt(
      context.sourceFile,
      reference.node,
      `feature '${featureName}' has an unsupported import ('${reference.specifier}')`,
    ),
  );
}

/**
 * Reports whether a feature import target is allowed by the layer contract.
 *
 * @param featureName - The importing feature folder.
 * @param specifier - The raw import specifier.
 * @param target - The resolved repository-relative target, or `null`.
 * @param external - True when the specifier is an external package or builtin.
 * @returns `true` when the import keeps the feature inside its allowed edges.
 */
function isAllowedFeatureImport(
  featureName: string,
  specifier: string,
  target: string | null,
  external: boolean,
): boolean {
  if (external) {
    return UI_PACKAGE_PATTERN.test(specifier);
  }

  if (!target) {
    return false;
  }

  if (target.startsWith("src/features/")) {
    return readFeatureName(target) === featureName;
  }

  if (target.startsWith(FEATURE_APP_PROVIDERS_PREFIX)) {
    return isHookModule(target);
  }

  return (
    target.startsWith(FEATURE_APP_HOOKS_PREFIX) ||
    FEATURE_SHARED_PREFIXES.some((prefix) => target.startsWith(prefix))
  );
}

/**
 * Reports whether a provider module is a hook rather than a component.
 *
 * @param target - The resolved repository-relative target.
 * @returns `true` when the file basename starts with `use`.
 */
function isHookModule(target: string): boolean {
  const baseName = target.slice(target.lastIndexOf("/") + 1);

  return baseName.startsWith("use");
}

/**
 * Reads the feature folder name from a repository path.
 *
 * @param relative - A repository-relative path.
 * @returns The feature name, or `null` when the path is not inside a feature folder.
 */
function readFeatureName(relative: string): string | null {
  const match = /^src\/features\/([^/]+)(?:\/|$)/.exec(relative);

  return match?.[1] ?? null;
}

/**
 * Reports whether a domain import target is inside the allowed layer.
 *
 * @param target - The resolved repository-relative target.
 * @returns `true` for `src/domain/**` and `src/lib/**`.
 */
function isAllowedDomainTarget(target: string): boolean {
  return target.startsWith("src/domain/") || target.startsWith("src/lib/");
}

/**
 * Reports whether a UI import target is inside the allowed layer.
 *
 * UI primitives compose other UI primitives, so `src/ui/**` is a valid local target as well.
 *
 * @param target - The resolved repository-relative target.
 * @returns `true` for `src/ui/**`, `src/lib/**`, and `src/theme/**`.
 */
function isAllowedUiTarget(target: string): boolean {
  return (
    target.startsWith("src/ui/") || target.startsWith("src/lib/") || target.startsWith("src/theme/")
  );
}

/**
 * Reports whether a theme import target is inside the allowed layer.
 *
 * The theme layer reads token types from `src/domain/theme/**` and shares `src/theme/**` and
 * `src/lib/**`. It never reaches into UI, features, app, or another domain folder.
 *
 * @param target - The resolved repository-relative target.
 * @returns `true` for `src/theme/**`, `src/domain/theme/**`, and `src/lib/**`.
 */
function isAllowedThemeTarget(target: string | null): boolean {
  if (!target) {
    return false;
  }

  return (
    target.startsWith("src/theme/") ||
    target.startsWith("src/domain/theme/") ||
    target.startsWith("src/lib/")
  );
}

/**
 * Reports whether a domain or lib module may import a Node builtin.
 *
 * @param relative - The repository-relative importing file path.
 * @param specifier - The raw module specifier.
 * @returns `true` when the builtin is on the per-module allowlist.
 */
function isAllowedBuiltin(relative: string, specifier: string): boolean {
  if (!specifier.startsWith("node:")) {
    return false;
  }

  const allowed = relative.startsWith(CONFIG_MODULE_PREFIX)
    ? CONFIG_BUILTIN_ALLOWLIST
    : BUILTIN_ALLOWLIST_BY_PATH.get(relative);

  return allowed?.has(specifier) ?? false;
}

/**
 * Builds the diagnostic message for a rejected external import.
 *
 * @param layer - The importing layer name.
 * @param specifier - The raw module specifier.
 * @returns The diagnostic message.
 */
function readExternalImportMessage(layer: string, specifier: string): string {
  if (specifier.startsWith("node:")) {
    return `${layer} must not import external packages or builtins ('${specifier}')`;
  }

  return `${layer} must not import external packages ('${specifier}')`;
}
