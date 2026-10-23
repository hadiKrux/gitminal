import ts from "typescript";
import {
  BUN_NETWORK_MEMBERS,
  BUN_SPAWN_MEMBERS,
  GIT_CLIENT_PATH,
  GIT_FIXTURE_PATH,
  NETWORK_MODULES,
  SPAWN_MODULES,
  UPDATE_CHECK_PATH,
} from "./check-boundary.constants";
import { collectImports } from "./check-boundary.imports";
import { type Diagnostic, diagnosticAt, toRepoPath } from "./check-support";

/** Paths allowed to spawn a process or open a network connection. */
const SPAWN_PATHS = [GIT_CLIENT_PATH, GIT_FIXTURE_PATH];
const NETWORK_PATHS = [UPDATE_CHECK_PATH];

/**
 * Flags process spawning and network calls outside their single privileged modules.
 *
 * @param sourceFile - The parsed source file.
 * @param errors - Finding accumulator.
 */
export function checkSpawnAndNetwork(sourceFile: ts.SourceFile, errors: Diagnostic[]): void {
  const relative = toRepoPath(sourceFile.fileName);

  checkModuleImports(sourceFile, relative, errors);
  checkCallNodes(sourceFile, relative, errors);
}

/**
 * Checks spawn and network module imports.
 *
 * @param sourceFile - The parsed source file.
 * @param relative - The repository-relative file path.
 * @param errors - Finding accumulator.
 */
function checkModuleImports(
  sourceFile: ts.SourceFile,
  relative: string,
  errors: Diagnostic[],
): void {
  for (const reference of collectImports(sourceFile)) {
    if (SPAWN_MODULES.has(reference.specifier)) {
      checkPrivilegedPath(
        sourceFile,
        reference.node,
        relative,
        SPAWN_PATHS,
        "process spawning",
        errors,
      );
    }

    if (NETWORK_MODULES.has(reference.specifier)) {
      checkPrivilegedPath(
        sourceFile,
        reference.node,
        relative,
        NETWORK_PATHS,
        "network access",
        errors,
      );
    }
  }
}

/**
 * Checks spawn and network call expressions.
 *
 * @param sourceFile - The parsed source file.
 * @param relative - The repository-relative file path.
 * @param errors - Finding accumulator.
 */
function checkCallNodes(sourceFile: ts.SourceFile, relative: string, errors: Diagnostic[]): void {
  const visit = (node: ts.Node): void => {
    if (isSpawnNode(node)) {
      checkPrivilegedPath(sourceFile, node, relative, SPAWN_PATHS, "process spawning", errors);
    }

    if (isNetworkNode(node)) {
      checkPrivilegedPath(sourceFile, node, relative, NETWORK_PATHS, "network access", errors);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
}

/**
 * Adds an error unless the file is one of the privileged paths.
 *
 * @param sourceFile - The parsed source file.
 * @param node - The offending node.
 * @param relative - The repository-relative file path.
 * @param allowedPaths - Paths allowed to perform the operation.
 * @param operation - The operation name used in the message.
 * @param errors - Finding accumulator.
 */
function checkPrivilegedPath(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  relative: string,
  allowedPaths: readonly string[],
  operation: string,
  errors: Diagnostic[],
): void {
  if (allowedPaths.includes(relative)) {
    return;
  }

  errors.push(
    diagnosticAt(sourceFile, node, `${operation} is allowed only in ${allowedPaths.join(" and ")}`),
  );
}

/**
 * Reports whether a node uses a Bun spawn or shell member.
 *
 * @param node - The candidate node.
 * @returns `true` for `Bun.spawn`, `Bun.spawnSync`, `Bun.shell`, and `Bun.$`.
 */
function isSpawnNode(node: ts.Node): boolean {
  if (ts.isTaggedTemplateExpression(node)) {
    return isBunMemberAccess(node.tag, BUN_SPAWN_MEMBERS);
  }

  return ts.isCallExpression(node) && isBunMemberAccess(node.expression, BUN_SPAWN_MEMBERS);
}

/**
 * Reports whether an expression accesses one of the named `Bun` members.
 *
 * @param expression - The candidate expression.
 * @param members - Allowed member names.
 * @returns `true` for `Bun.<member>`.
 */
function isBunMemberAccess(expression: ts.Expression, members: ReadonlySet<string>): boolean {
  return (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "Bun" &&
    members.has(expression.name.text)
  );
}

/**
 * Reports whether a node performs a network call or constructs a WebSocket.
 *
 * @param node - The candidate node.
 * @returns `true` for fetch, `Bun.fetch`, `Bun.connect`, and `WebSocket` usage.
 */
function isNetworkNode(node: ts.Node): boolean {
  if (ts.isNewExpression(node)) {
    return isWebSocketReference(node.expression);
  }

  if (!ts.isCallExpression(node)) {
    return false;
  }

  return isNetworkCall(node) || isWebSocketReference(node.expression);
}

/**
 * Reports whether a node is a direct fetch or Bun network call.
 *
 * @param node - The call expression.
 * @returns `true` for `fetch(...)`, `Bun.fetch(...)`, `Bun.connect(...)`,
 * `globalThis.fetch(...)`, or `window.fetch(...)`.
 */
function isNetworkCall(node: ts.CallExpression): boolean {
  if (ts.isIdentifier(node.expression) && node.expression.text === "fetch") {
    return true;
  }

  if (isBunMemberAccess(node.expression, BUN_NETWORK_MEMBERS)) {
    return true;
  }

  if (!ts.isPropertyAccessExpression(node.expression)) {
    return false;
  }

  const { expression, name } = node.expression;

  return (
    ts.isIdentifier(expression) &&
    (expression.text === "globalThis" || expression.text === "window") &&
    name.text === "fetch"
  );
}

/**
 * Reports whether an expression references the global WebSocket constructor.
 *
 * @param expression - The candidate expression.
 * @returns `true` for `WebSocket` and `globalThis.WebSocket`.
 */
function isWebSocketReference(expression: ts.Expression): boolean {
  if (ts.isIdentifier(expression)) {
    return expression.text === "WebSocket";
  }

  return (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "globalThis" &&
    expression.name.text === "WebSocket"
  );
}
