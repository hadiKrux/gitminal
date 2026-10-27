import { fileURLToPath } from "node:url";
import { addDefaultParsers, type FiletypeParserOptions } from "@opentui/core";

/** One vendored grammar and the language names it answers to. */
interface SyntaxParserDescriptor {
  /** Filetype resolved from the file path, and the asset file stem. */
  readonly filetype: string;
  /** Extra names, such as Markdown fence info strings, that resolve to this grammar. */
  readonly aliases: readonly string[];
}

/**
 * Grammars vendored into `assets/parsers` by `bun run parsers:vendor`.
 *
 * Each entry needs `<filetype>.wasm` and `<filetype>.highlights.scm` in the asset directory.
 * Injections are not registered because OpenTUI's worker cannot honor `injection.language`
 * metadata, so embedded languages inside HTML and PHP stay uncolored.
 */
const SYNTAX_PARSERS: readonly SyntaxParserDescriptor[] = Object.freeze([
  { filetype: "bash", aliases: ["sh", "shell", "zsh"] },
  { filetype: "css", aliases: [] },
  { filetype: "go", aliases: [] },
  { filetype: "html", aliases: ["htm"] },
  { filetype: "java", aliases: [] },
  { filetype: "json", aliases: [] },
  { filetype: "php", aliases: ["phtml"] },
  { filetype: "python", aliases: ["py"] },
  { filetype: "rust", aliases: ["rs"] },
  { filetype: "yaml", aliases: ["yml"] },
]);

/**
 * Builds the OpenTUI parser registrations for one asset directory.
 *
 * The directory URL must point at `assets/parsers` in development and next to the bundle in the
 * published package. Paths are converted to absolute filesystem paths because OpenTUI only passes
 * URLs through untouched, and its worker reads the wasm and query files from disk.
 *
 * @param assetRoot - Asset directory URL, with or without a trailing slash.
 * @returns Parser options ready for `addDefaultParsers`.
 */
export function buildSyntaxParserOptions(assetRoot: URL): FiletypeParserOptions[] {
  const root = assetRoot.href.endsWith("/") ? assetRoot.href : `${assetRoot.href}/`;

  return SYNTAX_PARSERS.map((descriptor) => ({
    filetype: descriptor.filetype,
    aliases: descriptor.aliases.length === 0 ? undefined : [...descriptor.aliases],
    wasm: fileURLToPath(new URL(`${descriptor.filetype}.wasm`, root)),
    queries: {
      highlights: [fileURLToPath(new URL(`${descriptor.filetype}.highlights.scm`, root))],
    },
  }));
}

/**
 * Registers the vendored grammars with OpenTUI.
 *
 * OpenTUI's tree-sitter client reads the registered parser set once, when the first highlighted
 * block initializes it, so this must run before the first render. Nothing is downloaded at runtime:
 * a missing asset makes the grammar unavailable rather than starting a fetch.
 *
 * @param assetRoot - Asset directory URL, with or without a trailing slash.
 */
export function registerSyntaxParsers(assetRoot: URL): void {
  addDefaultParsers(buildSyntaxParserOptions(assetRoot));
}
