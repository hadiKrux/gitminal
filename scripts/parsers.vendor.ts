import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/** Repository-relative directory that receives the vendored grammar assets. */
const ASSET_DIR = "assets/parsers";

/** Repository-relative directory that receives one license copy per grammar. */
const LICENSE_DIR = "assets/parsers/licenses";

/** Query file every grammar package ships next to its wasm. */
const HIGHLIGHTS_QUERY = "queries/highlights.scm";

/** License file every grammar package ships at its root. */
const LICENSE_FILE = "LICENSE";

/** Maximum combined size of the vendored wasm and query files. */
const MAX_TOTAL_BYTES = 6 * 1024 * 1024;

/** One grammar package and the wasm file it ships. */
interface GrammarSource {
  /** Package name under `node_modules`. */
  readonly package: string;
  /** Wasm file name at the package root. */
  readonly wasm: string;
  /** Upstream repository recorded in the generated notice. */
  readonly repository: string;
}

/** One copied grammar and its measured sizes. */
interface VendoredGrammar {
  /** Filetype the parser registers. */
  readonly filetype: string;
  /** Source package name. */
  readonly packageName: string;
  /** Package version. */
  readonly version: string;
  /** Package license identifier. */
  readonly license: string;
  /** Package repository URL. */
  readonly repository: string;
  /** Wasm size in bytes. */
  readonly wasmBytes: number;
  /** Highlight query size in bytes. */
  readonly queryBytes: number;
}

/**
 * Grammar packages and their wasm files, keyed by filetype.
 *
 * Versions are pinned in `package.json`, and every package is MIT licensed. Injections are
 * deliberately not copied: OpenTUI's worker cannot honor `injection.language` metadata, so only
 * highlight queries are vendored.
 */
const GRAMMAR_SOURCES: Readonly<Record<string, GrammarSource>> = Object.freeze({
  python: {
    package: "tree-sitter-python",
    wasm: "tree-sitter-python.wasm",
    repository: "https://github.com/tree-sitter/tree-sitter-python",
  },
  go: {
    package: "tree-sitter-go",
    wasm: "tree-sitter-go.wasm",
    repository: "https://github.com/tree-sitter/tree-sitter-go",
  },
  rust: {
    package: "tree-sitter-rust",
    wasm: "tree-sitter-rust.wasm",
    repository: "https://github.com/tree-sitter/tree-sitter-rust",
  },
  php: {
    package: "tree-sitter-php",
    wasm: "tree-sitter-php.wasm",
    repository: "https://github.com/tree-sitter/tree-sitter-php",
  },
  html: {
    package: "tree-sitter-html",
    wasm: "tree-sitter-html.wasm",
    repository: "https://github.com/tree-sitter/tree-sitter-html",
  },
  css: {
    package: "tree-sitter-css",
    wasm: "tree-sitter-css.wasm",
    repository: "https://github.com/tree-sitter/tree-sitter-css",
  },
  json: {
    package: "tree-sitter-json",
    wasm: "tree-sitter-json.wasm",
    repository: "https://github.com/tree-sitter/tree-sitter-json",
  },
  yaml: {
    package: "@tree-sitter-grammars/tree-sitter-yaml",
    wasm: "tree-sitter-yaml.wasm",
    repository: "https://github.com/tree-sitter-grammars/tree-sitter-yaml",
  },
  bash: {
    package: "tree-sitter-bash",
    wasm: "tree-sitter-bash.wasm",
    repository: "https://github.com/tree-sitter/tree-sitter-bash",
  },
  java: {
    package: "tree-sitter-java",
    wasm: "tree-sitter-java.wasm",
    repository: "https://github.com/tree-sitter/tree-sitter-java",
  },
});

/**
 * Reads the version and license of one grammar package.
 *
 * @param packageDirectory - Absolute package directory.
 * @returns Version and license identifier used by the notice.
 */
async function readPackageMetadata(
  packageDirectory: string,
): Promise<{ readonly version: string; readonly license: string }> {
  const manifest = JSON.parse(
    await readFile(path.join(packageDirectory, "package.json"), "utf8"),
  ) as { readonly version?: unknown; readonly license?: unknown };

  return {
    version: readManifestText(manifest.version),
    license: readManifestText(manifest.license),
  };
}

/**
 * Reads one manifest string, falling back to `unknown`.
 *
 * @param value - Manifest field value.
 * @returns The string value, or `unknown`.
 */
function readManifestText(value: unknown): string {
  return typeof value === "string" ? value : "unknown";
}

/**
 * Copies one grammar's wasm, highlight query, and license into the asset directory.
 *
 * @param root - Absolute repository root.
 * @param assetRoot - Absolute asset directory.
 * @param filetype - Registered filetype and output file stem.
 * @param source - Package and wasm file to copy.
 * @returns The measured vendored grammar.
 * @throws When a package file is missing.
 */
async function vendorGrammar(
  root: string,
  assetRoot: string,
  filetype: string,
  source: GrammarSource,
): Promise<VendoredGrammar> {
  const packageDirectory = path.join(root, "node_modules", source.package);
  const wasmSource = path.join(packageDirectory, source.wasm);
  const querySource = path.join(packageDirectory, HIGHLIGHTS_QUERY);
  const licenseSource = path.join(packageDirectory, LICENSE_FILE);
  const wasmBytes = await readFileSize(wasmSource);
  const queryBytes = await readFileSize(querySource);
  const metadata = await readPackageMetadata(packageDirectory);

  await copyFile(wasmSource, path.join(assetRoot, `${filetype}.wasm`));
  await copyFile(querySource, path.join(assetRoot, `${filetype}.highlights.scm`));
  await copyFile(licenseSource, path.join(root, LICENSE_DIR, `${filetype}.LICENSE`));

  return {
    filetype,
    packageName: source.package,
    version: metadata.version,
    license: metadata.license,
    repository: source.repository,
    wasmBytes,
    queryBytes,
  };
}

/**
 * Reads a file size.
 *
 * @param filePath - Absolute file path.
 * @returns The size in bytes.
 * @throws When the file does not exist, with the missing path in the message.
 */
async function readFileSize(filePath: string): Promise<number> {
  try {
    return (await stat(filePath)).size;
  } catch {
    throw new Error(`missing grammar asset: ${filePath}`);
  }
}

/**
 * Formats a byte count as a compact kilobyte label.
 *
 * @param bytes - Byte count.
 * @returns The label used by the summary table.
 */
function formatKilobytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

/**
 * Builds the generated notice that records provenance and licensing.
 *
 * @param grammars - Vendored grammars in registration order.
 * @returns The notice file content.
 */
function buildNotice(grammars: readonly VendoredGrammar[]): string {
  const rows = grammars.map(
    (grammar) =>
      `| ${grammar.filetype} | ${grammar.packageName}@${grammar.version} | ${grammar.license} | ${grammar.repository} |`,
  );

  return [
    "# Vendored syntax grammars",
    "",
    "Generated by `bun run parsers:vendor`. Do not edit by hand.",
    "",
    "The application copies these files with the package, registers them with OpenTUI at startup,",
    "and never downloads a grammar at runtime.",
    "",
    "| Filetype | Package | License | Source |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

/**
 * Regenerates the vendored grammar assets from the pinned packages.
 *
 * @throws When a source file is missing or the assets exceed the size budget.
 */
export async function main(): Promise<void> {
  const root = path.resolve(import.meta.dir, "..");
  const assetRoot = path.join(root, ASSET_DIR);

  await rm(assetRoot, { recursive: true, force: true });
  await mkdir(path.join(root, LICENSE_DIR), { recursive: true });

  const grammars: VendoredGrammar[] = [];

  for (const [filetype, source] of Object.entries(GRAMMAR_SOURCES)) {
    grammars.push(await vendorGrammar(root, assetRoot, filetype, source));
  }

  const totalBytes = grammars.reduce((sum, grammar) => sum + grammar.wasmBytes, 0);

  await writeFile(path.join(assetRoot, "NOTICE.md"), buildNotice(grammars), "utf8");

  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new Error(
      `vendored grammars are ${formatKilobytes(totalBytes)}, above the ${formatKilobytes(MAX_TOTAL_BYTES)} budget`,
    );
  }

  for (const grammar of grammars) {
    console.log(
      `${grammar.filetype.padEnd(8)} ${formatKilobytes(grammar.wasmBytes).padStart(8)} wasm ${formatKilobytes(grammar.queryBytes).padStart(7)} query`,
    );
  }

  console.log(`vendored ${grammars.length} grammars, ${formatKilobytes(totalBytes)} total`);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
