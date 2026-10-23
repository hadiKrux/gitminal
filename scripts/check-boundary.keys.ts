import ts from "typescript";
import {
  EQUALITY_OPERATORS,
  KEY_AWARE_FIELDS,
  KEY_AWARE_IDENTIFIERS,
  KEY_AWARE_RECEIVER_NAMES,
  KEY_AWARE_RECEIVER_SUFFIX_PATTERN,
  KEY_RECEIVER_NAME,
  KEY_RECEIVER_SUFFIX_PATTERN,
  RAW_KEY_ALLOWED_PATHS,
  RAW_KEY_ALLOWED_PREFIXES,
  RAW_KEY_FIELD_NAMES,
  WRAPPER_KINDS,
} from "./check-boundary.constants";
import type { ExpressionWrapper } from "./check-boundary.types";
import { type Diagnostic, diagnosticAt, toRepoPath } from "./check-support";

/**
 * Flags raw key string comparisons outside the keymap and the documented pre-shell helper.
 *
 * @param sourceFile - The parsed source file.
 * @param errors - Finding accumulator.
 */
export function checkRawKeys(sourceFile: ts.SourceFile, errors: Diagnostic[]): void {
  if (isRawKeyAllowedPath(toRepoPath(sourceFile.fileName))) {
    return;
  }

  const keyAware = isKeyAwareFile(sourceFile);

  const visit = (node: ts.Node): void => {
    if (isRawKeyComparison(node, keyAware)) {
      errors.push(
        diagnosticAt(
          sourceFile,
          node,
          "raw key string comparison is allowed only in src/domain/keymap/**, src/app/hooks/useHotkeys.ts, and src/app/quit.key.ts",
        ),
      );
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
}

/**
 * Reports whether raw key comparisons are allowed in a repository path.
 *
 * @param relative - The repository-relative file path.
 * @returns `true` for the keymap layer and the documented pre-shell helper.
 */
function isRawKeyAllowedPath(relative: string): boolean {
  return (
    RAW_KEY_ALLOWED_PATHS.has(relative) ||
    RAW_KEY_ALLOWED_PREFIXES.some((prefix) => relative.startsWith(prefix))
  );
}

/**
 * Reports whether a file handles key events directly.
 *
 * @param sourceFile - The parsed source file.
 * @returns `true` when the file mentions `KeyEvent`, `useKeyboard`, or a `key.name`/`key.sequence` access.
 */
function isKeyAwareFile(sourceFile: ts.SourceFile): boolean {
  let aware = false;

  const visit = (node: ts.Node): void => {
    if (aware) {
      return;
    }

    if (ts.isIdentifier(node) && KEY_AWARE_IDENTIFIERS.has(node.text)) {
      aware = true;
    }

    if (isKeyFieldAccess(node)) {
      aware = true;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return aware;
}

/**
 * Reports whether a node accesses a key field on an identifier named `key`.
 *
 * @param node - The candidate node.
 * @returns `true` for a `key.name` or `key.sequence` access.
 */
function isKeyFieldAccess(node: ts.Node): boolean {
  return (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text.toLowerCase() === KEY_RECEIVER_NAME &&
    KEY_AWARE_FIELDS.has(node.name.text)
  );
}

/**
 * Reports whether a node compares a string literal against a key reference.
 *
 * @param node - The candidate node.
 * @param keyAware - True when the file handles key events directly.
 * @returns `true` for an equality comparison involving a key reference.
 */
function isRawKeyComparison(node: ts.Node, keyAware: boolean): boolean {
  if (!ts.isBinaryExpression(node) || !EQUALITY_OPERATORS.has(node.operatorToken.kind)) {
    return false;
  }

  return (
    (isStringLiteralNode(node.left) && referencesRawKey(node.right, keyAware)) ||
    (isStringLiteralNode(node.right) && referencesRawKey(node.left, keyAware))
  );
}

/**
 * Reports whether a node is a string or no-substitution template literal.
 *
 * @param node - The candidate node.
 * @returns `true` for a string literal.
 */
function isStringLiteralNode(node: ts.Node): boolean {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

/**
 * Reports whether a compared operand reads a key field or a bare key-field identifier.
 *
 * @param node - The compared operand.
 * @param keyAware - True when the file handles key events directly.
 * @returns `true` when the operand references a key field.
 */
function referencesRawKey(node: ts.Node, keyAware: boolean): boolean {
  if (ts.isPropertyAccessExpression(node)) {
    return isRawKeyPropertyAccess(node, keyAware) || referencesRawKey(node.expression, keyAware);
  }

  if (ts.isIdentifier(node)) {
    return keyAware && RAW_KEY_FIELD_NAMES.has(node.text);
  }

  const inner = readInnerExpression(node);

  return inner ? referencesRawKey(inner, keyAware) : false;
}

/**
 * Reports whether a property access reads a key field from a key-like receiver.
 *
 * @param node - The property access.
 * @param keyAware - True when the file handles key events directly.
 * @returns `true` for `key.name`, `someKey.name`, or a key-aware `event.code`.
 */
function isRawKeyPropertyAccess(node: ts.PropertyAccessExpression, keyAware: boolean): boolean {
  return RAW_KEY_FIELD_NAMES.has(node.name.text) && isKeyEventReceiver(node.expression, keyAware);
}

/**
 * Reads the expression wrapped by a call or type wrapper node.
 *
 * @param node - The candidate node.
 * @returns The inner expression, or `null` for other nodes.
 */
function readInnerExpression(node: ts.Node): ts.Expression | null {
  if (ts.isCallExpression(node)) {
    return node.expression;
  }

  if (WRAPPER_KINDS.has(node.kind)) {
    return (node as ExpressionWrapper).expression;
  }

  return null;
}

/**
 * Reports whether an expression looks like the receiver of a key event.
 *
 * A receiver named `key` or ending in `Key` is key-like in every file. Short names such as `e`,
 * `ev`, `event`, and identifiers ending in `Event` are key-like only when the file already
 * handles key events, so an ordinary `catch (e) { e.code === "ENOENT" }` is not flagged.
 *
 * @param expression - The candidate expression.
 * @param keyAware - True when the file handles key events directly.
 * @returns `true` for a key-like receiver.
 */
function isKeyEventReceiver(expression: ts.Expression, keyAware: boolean): boolean {
  if (!ts.isIdentifier(expression)) {
    return false;
  }

  const name = expression.text;

  if (name.toLowerCase() === KEY_RECEIVER_NAME || KEY_RECEIVER_SUFFIX_PATTERN.test(name)) {
    return true;
  }

  if (!keyAware) {
    return false;
  }

  return (
    KEY_AWARE_RECEIVER_NAMES.has(name.toLowerCase()) || KEY_AWARE_RECEIVER_SUFFIX_PATTERN.test(name)
  );
}
