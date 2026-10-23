import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { DocEntry, StructureDocument, TreeEntry } from "./check-structure.types";
import {
  type Diagnostic,
  fileDiagnostic,
  isSourceFile,
  isTestFile,
  listFiles,
  listSourceFiles,
  REPO_ROOT,
  report,
  SCRIPTS_DIR,
  SRC_DIR,
} from "./check-support";

/** Repository path of the architecture contract. */
const ARCHITECTURE_PATH = "docs/technical-implmentations/00-project-architecture.md";

/** Repository directory that holds the feature documents. */
const DOCS_DIRECTORY = "docs/technical-implmentations";

/**
 * Runs the structure checker.
 *
 * @param strict - True when planned paths are errors instead of warnings.
 */
export function main(strict: boolean = process.argv.includes("--strict")): void {
  const title = strict ? "Structure check (strict)" : "Structure check";
  const markdown = readArchitectureFile(path.join(REPO_ROOT, ARCHITECTURE_PATH));

  if (markdown === null) {
    report(title, [
      fileDiagnostic(ARCHITECTURE_PATH, "architecture document is missing or unreadable"),
    ]);

    return;
  }

  const parsed = parseArchitecture(markdown);
  const errors = [...parsed.errors];
  const warnings: Diagnostic[] = [];
  const reported = new Set<string>();

  if (errors.length === 0) {
    errors.push(...findUnlistedFiles(parsed.tree, listStructureSourceFiles()));
    errors.push(...compareDocFiles(parsed.docMap, readDocFiles()));
    errors.push(...checkFeatureDocs(parsed.docMap));
    collectPlannedTreePaths(parsed.tree, warnings, reported);
    collectPlannedDocPaths(parsed.docMap, warnings, reported);
  }

  if (strict) {
    errors.push(...warnings);
    warnings.length = 0;
  }

  report(title, errors, warnings);
}

/**
 * Reads the architecture document without throwing when it is missing or unreadable.
 *
 * @param file - Absolute path of the architecture document.
 * @returns The document text, or `null` when it cannot be read.
 */
export function readArchitectureFile(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * Lists every source file the structure check must find in the section 4 tree.
 *
 * Both `src/` and `scripts/` are checked, because the tree declares the enforcement scripts as
 * well as application code.
 *
 * @returns Repository-relative source files, sorted.
 */
export function listStructureSourceFiles(): string[] {
  return [...listSourceFiles(), ...listSourceFiles(SCRIPTS_DIR)]
    .filter((file) => !isTestFile(file))
    .sort();
}

/**
 * Reads the docs directory and lists the markdown file names it contains.
 *
 * @returns The available doc file names.
 */
function readDocFiles(): Set<string> {
  const directory = path.join(REPO_ROOT, DOCS_DIRECTORY);

  if (!existsSync(directory)) {
    return new Set();
  }

  return new Set(readdirSync(directory).filter((name) => name.endsWith(".md")));
}

/**
 * Parses the sections the structure checker needs.
 *
 * @param markdown - The full architecture document.
 * @returns The parsed tree, doc map, and setup errors.
 */
export function parseArchitecture(markdown: string): StructureDocument {
  const errors: Diagnostic[] = [];
  const tree = parseTreeSection(markdown, errors);
  const docMap = parseDocMapSection(markdown, errors);

  return { tree, docMap, errors };
}

/**
 * Reads the section 4 text and parses its tree.
 *
 * @param markdown - The full architecture document.
 * @param errors - Setup failure accumulator.
 * @returns The parsed tree entries.
 */
function parseTreeSection(markdown: string, errors: Diagnostic[]): TreeEntry[] {
  const section = readSection(markdown, "## 4.");

  if (!section) {
    errors.push(fileDiagnostic(ARCHITECTURE_PATH, "missing section 4 heading '## 4.'"));

    return [];
  }

  return parseTree(section, errors);
}

/**
 * Reads the section 15 text and parses its doc map.
 *
 * @param markdown - The full architecture document.
 * @param errors - Setup failure accumulator.
 * @returns The parsed doc entries.
 */
function parseDocMapSection(markdown: string, errors: Diagnostic[]): DocEntry[] {
  const section = readSection(markdown, "## 15.");

  if (!section) {
    errors.push(fileDiagnostic(ARCHITECTURE_PATH, "missing section 15 heading '## 15.'"));

    return [];
  }

  return parseDocMap(section);
}

/**
 * Reads one Markdown section up to the next level-two heading.
 *
 * The heading is matched at the start of a line, so `### 4.1` cannot satisfy a `## 4.` lookup.
 *
 * @param markdown - The full document.
 * @param heading - The exact heading line prefix that starts the section.
 * @returns The section text including the heading, or `null` when it is absent.
 */
function readSection(markdown: string, heading: string): string | null {
  const pattern = new RegExp(`^${escapeRegExp(heading)}(?=\\s|$)`, "m");
  const match = pattern.exec(markdown);

  if (!match) {
    return null;
  }

  const start = match.index;
  const next = markdown.indexOf("\n## ", start + match[0].length);

  return markdown.slice(start, next < 0 ? undefined : next);
}

/**
 * Escapes a literal string for use inside a regular expression.
 *
 * @param value - The literal text.
 * @returns The escaped text.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parses the enforced folder tree from the section 4 fenced block.
 *
 * @param section - The section 4 text.
 * @param errors - Setup failure accumulator.
 * @returns Every file and folder entry with its repository-relative path.
 */
function parseTree(section: string, errors: Diagnostic[]): TreeEntry[] {
  const body = readTreeFence(section, errors);

  if (body === null) {
    return [];
  }

  return parseTreeLines(body);
}

/**
 * Reads the body of the section 4 fenced tree block.
 *
 * @param section - The section 4 text.
 * @param errors - Setup failure accumulator.
 * @returns The fenced body, or `null` when the fence is absent or unclosed.
 */
function readTreeFence(section: string, errors: Diagnostic[]): string | null {
  const fenceStart = section.indexOf("```text");

  if (fenceStart < 0) {
    errors.push(fileDiagnostic(ARCHITECTURE_PATH, "section 4 has no '```text' tree block"));

    return null;
  }

  const bodyStart = section.indexOf("\n", fenceStart) + 1;
  const fenceEnd = section.indexOf("```", bodyStart);

  if (fenceEnd < 0) {
    errors.push(fileDiagnostic(ARCHITECTURE_PATH, "section 4 tree block is not closed"));

    return null;
  }

  return section.slice(bodyStart, fenceEnd);
}

/**
 * Parses indented tree lines into repository-relative paths.
 *
 * @param body - The fenced tree body.
 * @returns Every tree entry.
 */
function parseTreeLines(body: string): TreeEntry[] {
  const stack: string[] = [];
  const entries: TreeEntry[] = [];

  for (const line of body.split("\n")) {
    const name = line.trim();

    if (name.length === 0 || name === "...") {
      continue;
    }

    const depth = Math.floor((line.length - line.trimStart().length) / 2);
    stack.length = depth;
    stack[depth] = name;

    const joined = stack
      .slice(0, depth + 1)
      .join("")
      .replace(/^gitminal\//, "");

    if (joined.length > 0) {
      entries.push({ path: joined });
    }
  }

  return entries;
}

/**
 * Parses the section 15 doc-to-path map.
 *
 * @param section - The section 15 text.
 * @returns One entry per table row with backticked ownership paths.
 */
export function parseDocMap(section: string): DocEntry[] {
  const entries: DocEntry[] = [];

  for (const line of section.split("\n")) {
    const doc = readDocName(line);

    if (!doc) {
      continue;
    }

    entries.push({ doc, paths: readOwnershipPaths(line) });
  }

  return entries;
}

/**
 * Reads the doc file name from a section 15 table row.
 *
 * @param line - One line of the section.
 * @returns The doc file name, or `null` for other lines.
 */
function readDocName(line: string): string | null {
  if (!line.trim().startsWith("|")) {
    return null;
  }

  const doc = readCells(line)[0]?.replaceAll("`", "") ?? "";

  return doc.endsWith(".md") ? doc : null;
}

/**
 * Reads the ownership paths from a section 15 table row.
 *
 * @param line - One table row.
 * @returns The backticked paths from the ownership column.
 */
function readOwnershipPaths(line: string): string[] {
  const ownership = readCells(line).slice(2).join(" ");

  return [...ownership.matchAll(/`([^`]+)`/g)]
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value));
}

/**
 * Splits a markdown table row into trimmed cells.
 *
 * @param line - The table row.
 * @returns The cell values.
 */
function readCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

/**
 * Finds implemented source files that are absent from the section 4 tree.
 *
 * @param tree - The parsed tree entries.
 * @param sourceFiles - Repository-relative source files to check.
 * @returns One diagnostic per unlisted implemented file.
 */
export function findUnlistedFiles(tree: TreeEntry[], sourceFiles: readonly string[]): Diagnostic[] {
  const treeFiles = new Set(tree.map((entry) => entry.path));

  return sourceFiles
    .filter((file) => !isTestFile(file) && !treeFiles.has(file))
    .map((file) => fileDiagnostic(file, "implemented file is missing from the section 4 tree"));
}

/**
 * Finds section 15 doc files that do not exist in the docs directory listing.
 *
 * @param docMap - The parsed doc map.
 * @param availableDocs - The markdown file names present in the docs directory.
 * @returns One diagnostic per missing doc file.
 */
export function compareDocFiles(
  docMap: readonly DocEntry[],
  availableDocs: ReadonlySet<string>,
): Diagnostic[] {
  return docMap
    .filter((entry) => !availableDocs.has(entry.doc))
    .map((entry) =>
      fileDiagnostic(
        `${DOCS_DIRECTORY}/${entry.doc}`,
        "section 15 doc file is missing from docs/technical-implmentations",
      ),
    );
}

/**
 * Finds implemented feature folders that have no section 15 doc entry.
 *
 * @param docMap - The parsed doc map.
 * @param featureNames - The implemented feature folder names.
 * @returns One diagnostic per undocumented feature folder.
 */
export function findUndocumentedFeatures(
  docMap: readonly DocEntry[],
  featureNames: readonly string[],
): Diagnostic[] {
  const documented = new Set<string>();

  for (const entry of docMap) {
    for (const declaredPath of entry.paths) {
      const match = /^features\/([^/]+)$/.exec(declaredPath);

      if (match?.[1]) {
        documented.add(match[1]);
      }
    }
  }

  return featureNames
    .filter((name) => !documented.has(name))
    .map((name) =>
      fileDiagnostic(
        `src/features/${name}`,
        "implemented feature folder has no section 15 doc entry",
      ),
    );
}

/**
 * Collects the feature folder names that contain at least one implemented source file.
 *
 * @returns The implemented feature folder names.
 */
function listImplementedFeatures(): string[] {
  const featuresDir = path.join(SRC_DIR, "features");

  if (!existsSync(featuresDir)) {
    return [];
  }

  return readdirSync(featuresDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name)
    .filter((name) => hasImplementedSource(path.join(featuresDir, name)));
}

/**
 * Reports whether a folder contains a source file that is not a test.
 *
 * @param folder - Absolute folder path.
 * @returns `true` when the folder has an implemented source file.
 */
function hasImplementedSource(folder: string): boolean {
  return listFiles(folder).some((file) => isSourceFile(file) && !isTestFile(file));
}

/**
 * Checks implemented feature folders against the section 15 doc map.
 *
 * @param docMap - The parsed doc map.
 * @returns One diagnostic per undocumented feature folder.
 */
export function checkFeatureDocs(docMap: readonly DocEntry[]): Diagnostic[] {
  return findUndocumentedFeatures(docMap, listImplementedFeatures());
}

/**
 * Warns for section 4 source paths that are planned but not implemented yet.
 *
 * Reports the highest missing ancestor once so a missing planned folder does not repeat every
 * descendant file. The default mode stays readable in M1; strict mode still fails.
 *
 * @param tree - The parsed tree entries.
 * @param warnings - Warning accumulator.
 * @param reported - Paths already reported by either planned-path collector.
 */
function collectPlannedTreePaths(
  tree: TreeEntry[],
  warnings: Diagnostic[],
  reported: Set<string>,
): void {
  for (const entry of tree) {
    if (!entry.path.startsWith("src/") || existsSync(path.join(REPO_ROOT, entry.path))) {
      continue;
    }

    const missingPath = findMissingAncestor(entry.path);

    if (reported.has(missingPath)) {
      continue;
    }

    reported.add(missingPath);
    warnings.push(fileDiagnostic(missingPath, "planned path is missing"));
  }
}

/**
 * Warns for section 15 paths that do not exist yet.
 *
 * Reports the highest missing ancestor once per path, so a planned folder is named once instead of
 * once per file.
 *
 * @param docMap - The parsed doc map.
 * @param warnings - Warning accumulator.
 * @param reported - Paths already reported by either planned-path collector.
 */
function collectPlannedDocPaths(
  docMap: DocEntry[],
  warnings: Diagnostic[],
  reported: Set<string>,
): void {
  for (const entry of docMap) {
    for (const declaredPath of entry.paths) {
      const sourcePath = toSourcePath(declaredPath);

      if (!sourcePath || existsSync(path.join(REPO_ROOT, sourcePath))) {
        continue;
      }

      const missingPath = findMissingAncestor(sourcePath);

      if (reported.has(missingPath)) {
        continue;
      }

      reported.add(missingPath);
      warnings.push(fileDiagnostic(missingPath, `documented in ${entry.doc} but not implemented`));
    }
  }
}

/**
 * Finds the highest missing ancestor of a repository path.
 *
 * @param repoPath - The missing path.
 * @returns The shallowest ancestor that does not exist.
 */
export function findMissingAncestor(repoPath: string): string {
  const segments = repoPath.split("/");

  for (let index = 1; index <= segments.length; index += 1) {
    const candidate = segments.slice(0, index).join("/");

    if (!existsSync(path.join(REPO_ROOT, candidate))) {
      return candidate;
    }
  }

  return repoPath;
}

/**
 * Maps a section 15 ownership path to its repository-relative source path.
 *
 * @param declaredPath - The backticked ownership path.
 * @returns The `src/...` path, or `null` for paths outside the source tree.
 */
function toSourcePath(declaredPath: string): string | null {
  const value = declaredPath.replace(/\/+$/, "");

  if (value.startsWith("src/")) {
    return value;
  }

  if (value === "theme") {
    return "src/theme";
  }

  if (/^(app|features|domain|lib|ui|test|theme)\//.test(value)) {
    return `src/${value}`;
  }

  return null;
}

if (import.meta.main) {
  main();
}
