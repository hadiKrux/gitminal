import { describe, expect, it } from "bun:test";
import path from "node:path";
import {
  findMissingAncestor,
  findUndocumentedFeatures,
  findUnlistedFiles,
  listStructureSourceFiles,
  parseArchitecture,
  parseOwnershipMap,
  readArchitectureFile,
} from "./check-structure";
import { REPO_ROOT } from "./check-support";

/**
 * Joins diagnostic messages for a substring assertion.
 *
 * @param errors - The diagnostics.
 * @returns The joined messages.
 */
function messages(errors: readonly { message: string }[]): string {
  return errors.map((error) => error.message).join("\n");
}

describe("parseArchitecture", () => {
  it("reports missing section headings instead of throwing", () => {
    const parsed = parseArchitecture("# No contract");

    expect(parsed.errors).toHaveLength(2);
    expect(messages(parsed.errors)).toContain("missing section 4 heading");
    expect(messages(parsed.errors)).toContain("missing section 15 heading");
  });

  it("reports a missing section 4 tree fence", () => {
    const parsed = parseArchitecture("## 4.\n\nNo tree.\n\n## 15.\n\nNo table.\n");

    expect(parsed.errors).toHaveLength(1);
    expect(messages(parsed.errors)).toContain("section 4 has no '```text' tree block");
  });

  it("does not treat a nested level-three heading as section 4", () => {
    const markdown = [
      "# Contract",
      "",
      "### 4.1 Nested heading",
      "",
      "```text",
      "nested/",
      "```",
      "",
      "## 4. Enforced folder structure",
      "",
      "```text",
      "gitminal/",
      "  src/",
      "    index.tsx",
      "```",
      "",
      "## 15. Feature ownership map",
      "",
      "| Feature | Owned paths |",
      "| --- | --- |",
      "| F-21 Startup splash | `features/splash` |",
    ].join("\n");
    const parsed = parseArchitecture(markdown);

    expect(parsed.errors).toEqual([]);
    expect(parsed.tree.map((entry) => entry.path)).toContain("src/index.tsx");
    expect(parsed.ownershipMap).toEqual([
      { area: "F-21 Startup splash", paths: ["features/splash"] },
    ]);
  });
});

describe("parseOwnershipMap", () => {
  it("skips header and separator rows and reads every backticked path", () => {
    const section = [
      "## 15. Feature ownership map",
      "",
      "| Feature | Owned paths |",
      "| --- | --- |",
      "| F-01 App shell | `features/shell`, `app/AppShellHost.tsx` |",
    ].join("\n");

    expect(parseOwnershipMap(section)).toEqual([
      { area: "F-01 App shell", paths: ["features/shell", "app/AppShellHost.tsx"] },
    ]);
  });
});

describe("findUnlistedFiles", () => {
  it("reports unlisted implemented .js and .jsx files", () => {
    const errors = findUnlistedFiles(
      [{ path: "src/index.tsx" }],
      ["src/index.tsx", "src/lib/probe.js", "src/features/probe.jsx", "src/lib/probe.test.js"],
    );

    expect(errors).toHaveLength(2);
    expect(errors[0]?.file).toBe("src/lib/probe.js");
    expect(errors[1]?.file).toBe("src/features/probe.jsx");
    expect(errors[0]?.message).toContain("missing from the section 4 tree");
  });
});

describe("listStructureSourceFiles", () => {
  it("includes scripts source files and excludes their test files", () => {
    const files = listStructureSourceFiles();

    expect(files).toContain("scripts/check-boundary.ts");
    expect(files).toContain("scripts/check-support.ts");
    expect(files).not.toContain("scripts/check-boundary.test.ts");
  });
});

describe("readArchitectureFile", () => {
  it("returns null instead of throwing when the document is missing", () => {
    expect(readArchitectureFile(path.join(REPO_ROOT, "missing-contract.md"))).toBeNull();
  });
});

describe("findUndocumentedFeatures", () => {
  it("reports an implemented feature folder without an ownership entry", () => {
    const errors = findUndocumentedFeatures(
      [{ area: "F-21 Startup splash", paths: ["features/splash"] }],
      ["splash", "shell"],
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]?.file).toBe("src/features/shell");
    expect(errors[0]?.message).toContain("no section 15 ownership entry");
  });
});

describe("findMissingAncestor", () => {
  it("returns the highest missing ancestor of a planned path", () => {
    expect(findMissingAncestor("src/features/splash")).toBe("src/features/splash");
    expect(findMissingAncestor("src/features/missing-panel/Panel.tsx")).toBe(
      "src/features/missing-panel",
    );
  });
});
