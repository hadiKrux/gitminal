import { describe, expect, it } from "bun:test";
import { stat } from "node:fs/promises";
import path from "node:path";
import { getTreeSitterClient } from "@opentui/core";
import { buildSyntaxParserOptions } from "@/app/syntax.parsers";

/** Vendored asset directory used by the app and the test preload. */
const ASSET_ROOT = new URL("../../assets/parsers/", import.meta.url);

/** Filetypes the app registers, in registration order. */
const EXPECTED_FILETYPES: readonly string[] = Object.freeze([
  "bash",
  "css",
  "go",
  "html",
  "java",
  "json",
  "php",
  "python",
  "rust",
  "yaml",
]);

/** One short snippet per language that must produce at least one highlight. */
const SAMPLES: readonly { readonly filetype: string; readonly content: string }[] = Object.freeze([
  { filetype: "bash", content: 'echo "hello"\n' },
  { filetype: "css", content: ".item { color: red; }\n" },
  { filetype: "go", content: "package main\n\nfunc main() {}\n" },
  { filetype: "html", content: '<div class="item">text</div>\n' },
  { filetype: "java", content: "class Item { int count = 1; }\n" },
  { filetype: "json", content: '{"item": 1}\n' },
  { filetype: "php", content: "<?php function item() { return 1; }\n" },
  { filetype: "python", content: "def item(count):\n    return count\n" },
  { filetype: "rust", content: "fn main() { let count: u8 = 1; }\n" },
  { filetype: "yaml", content: "item: value\n" },
]);

describe("buildSyntaxParserOptions", () => {
  it("registers one parser per vendored grammar", () => {
    const options = buildSyntaxParserOptions(ASSET_ROOT);

    expect(options.map((option) => option.filetype)).toEqual([...EXPECTED_FILETYPES]);
  });

  it("points every parser at an absolute wasm and query file", () => {
    const options = buildSyntaxParserOptions(ASSET_ROOT);

    for (const option of options) {
      expect(path.isAbsolute(option.wasm), option.filetype).toBe(true);
      expect(option.wasm.endsWith(`${option.filetype}.wasm`), option.wasm).toBe(true);

      const query = option.queries.highlights[0];

      expect(query, option.filetype).toBeDefined();
      expect(path.isAbsolute(query ?? ""), option.filetype).toBe(true);
      expect(query?.endsWith(`${option.filetype}.highlights.scm`), option.filetype).toBe(true);
    }
  });

  it("keeps aliases unique and clear of filetypes", () => {
    const options = buildSyntaxParserOptions(ASSET_ROOT);
    const filetypes = new Set(options.map((option) => option.filetype));
    const aliases = options.flatMap((option) => option.aliases ?? []);

    expect(new Set(aliases).size).toBe(aliases.length);

    for (const alias of aliases) {
      expect(filetypes.has(alias), alias).toBe(false);
    }
  });
});

describe("vendored grammar assets", () => {
  it("ships a non-empty wasm and query file for every filetype", async () => {
    const options = buildSyntaxParserOptions(ASSET_ROOT);

    for (const option of options) {
      const wasm = await stat(option.wasm);
      const query = await stat(option.queries.highlights[0] ?? "");

      expect(wasm.size, option.filetype).toBeGreaterThan(0);
      expect(query.size, option.filetype).toBeGreaterThan(0);
    }
  });

  it("stays within the documented size budget", async () => {
    const options = buildSyntaxParserOptions(ASSET_ROOT);
    let totalBytes = 0;

    for (const option of options) {
      totalBytes += (await stat(option.wasm)).size;
      totalBytes += (await stat(option.queries.highlights[0] ?? "")).size;
    }

    expect(totalBytes).toBeLessThanOrEqual(6 * 1024 * 1024);
  });
});

describe("vendored grammar highlighting", () => {
  it("loads every parser and returns highlights for a sample", async () => {
    const client = getTreeSitterClient();

    for (const sample of SAMPLES) {
      const result = await client.highlightOnce(sample.content, sample.filetype);

      expect(result.error, sample.filetype).toBeUndefined();
      expect(result.highlights?.length ?? 0, sample.filetype).toBeGreaterThan(0);
    }
  }, 30_000);

  it("resolves the python keyword capture", async () => {
    const result = await getTreeSitterClient().highlightOnce(
      "def item():\n    return 1\n",
      "python",
    );
    const groups = (result.highlights ?? []).map((highlight) => highlight[2]);

    expect(result.error).toBeUndefined();
    expect(groups).toContain("keyword");
  }, 30_000);
});
