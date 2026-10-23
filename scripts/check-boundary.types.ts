import type ts from "typescript";

/** One import or re-export reference. */
export interface ImportReference {
  /** The raw module specifier. */
  specifier: string;
  /** The AST node used for diagnostics. */
  node: ts.Node;
}

/** Layer facts shared by the per-import checks for one source file. */
export interface ImportLayerContext {
  /** The parsed source file. */
  sourceFile: ts.SourceFile;
  /** The source file as a POSIX repository path. */
  relative: string;
  /** True when the file lives under `src/domain/`. */
  isDomain: boolean;
  /** True when the file lives under `src/lib/`. */
  isLib: boolean;
  /** True when the file lives under `src/ui/`. */
  isUi: boolean;
  /** True when the file lives under `src/theme/`. */
  isTheme: boolean;
  /** The owning feature folder, or `null` outside `src/features/`. */
  featureName: string | null;
}

/** A node that wraps an inner expression. */
export interface ExpressionWrapper extends ts.Node {
  /** The wrapped expression. */
  expression: ts.Expression;
}
