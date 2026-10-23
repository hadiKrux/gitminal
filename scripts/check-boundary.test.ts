import { describe, expect, it } from "bun:test";
import path from "node:path";
import type ts from "typescript";
import {
  checkImports,
  checkRawKeys,
  checkSourceFile,
  checkSpawnAndNetwork,
  resolveImportTarget,
} from "./check-boundary";
import { type Diagnostic, parseSourceText, REPO_ROOT } from "./check-support";

/**
 * Parses inline source text as a repository file.
 *
 * @param relative - Repository-relative file path.
 * @param text - The source text.
 * @returns The parsed source file.
 */
function parse(relative: string, text: string): ts.SourceFile {
  return parseSourceText(path.join(REPO_ROOT, relative), text);
}

/**
 * Runs the import rules for inline source.
 *
 * @param relative - Repository-relative file path.
 * @param text - The source text.
 * @returns The import diagnostics.
 */
function importErrors(relative: string, text: string): Diagnostic[] {
  const errors: Diagnostic[] = [];
  checkImports(parse(relative, text), errors);

  return errors;
}

/**
 * Runs the raw-key rule for inline source.
 *
 * @param relative - Repository-relative file path.
 * @param text - The source text.
 * @returns The raw-key diagnostics.
 */
function rawKeyErrors(relative: string, text: string): Diagnostic[] {
  const errors: Diagnostic[] = [];
  checkRawKeys(parse(relative, text), errors);

  return errors;
}

/**
 * Runs the spawn and network rules for inline source.
 *
 * @param relative - Repository-relative file path.
 * @param text - The source text.
 * @returns The spawn and network diagnostics.
 */
function spawnErrors(relative: string, text: string): Diagnostic[] {
  const errors: Diagnostic[] = [];
  checkSpawnAndNetwork(parse(relative, text), errors);

  return errors;
}

/**
 * Runs every boundary rule for inline source.
 *
 * @param relative - Repository-relative file path.
 * @param text - The source text.
 * @returns The boundary diagnostics.
 */
function boundaryErrors(relative: string, text: string): Diagnostic[] {
  const errors: Diagnostic[] = [];
  checkSourceFile(parse(relative, text), errors);

  return errors;
}

/**
 * Joins diagnostic messages for a substring assertion.
 *
 * @param errors - The diagnostics.
 * @returns The joined messages.
 */
function messages(errors: readonly Diagnostic[]): string {
  return errors.map((error) => error.message).join("\n");
}

describe("checkImports lib layer", () => {
  it("rejects external packages and builtins under src/lib", () => {
    const errors = importErrors("src/lib/probe.ts", 'import { readFileSync } from "node:fs";');

    expect(errors).toHaveLength(1);
    expect(messages(errors)).toContain("lib must not import external packages");
  });

  it("rejects local imports outside src/lib", () => {
    const errors = importErrors("src/lib/probe.ts", 'import { App } from "@/app/App";');

    expect(errors).toHaveLength(1);
    expect(messages(errors)).toContain("lib may import only lib modules");
  });

  it("allows local lib imports", () => {
    const errors = importErrors("src/lib/probe.ts", 'import { parseVersion } from "@/lib/semver";');

    expect(errors).toEqual([]);
  });

  it("allows node:path in the shared paths helper", () => {
    const errors = importErrors(
      "src/lib/paths.ts",
      'import path from "node:path";\nimport os from "node:os";',
    );

    expect(errors).toEqual([]);
  });

  it("rejects a Node builtin that is not on the lib module allowlist", () => {
    const errors = importErrors("src/lib/semver.ts", 'import { readFileSync } from "node:fs";');

    expect(errors).toHaveLength(1);
    expect(messages(errors)).toContain("lib must not import external packages or builtins");
  });
});

describe("checkImports domain layer", () => {
  it("rejects external packages and React under src/domain", () => {
    const errors = importErrors(
      "src/domain/probe.ts",
      'import { useState } from "react";\nimport { z } from "zod";',
    );

    expect(errors).toHaveLength(2);
    expect(messages(errors)).toContain("domain must not import external packages ('react')");
    expect(messages(errors)).toContain("domain must not import external packages ('zod')");
  });

  it("allows domain and lib imports", () => {
    const errors = importErrors(
      "src/domain/update/probe.ts",
      'import { parseVersion } from "@/lib/semver";\nimport type { UpdateCheckResult } from "./update.types";',
    );

    expect(errors).toEqual([]);
  });

  it("rejects ui, app, and feature imports", () => {
    const errors = importErrors(
      "src/domain/update/probe.ts",
      'import { Panel } from "@/ui/Panel";\nimport { App } from "@/app/App";\nimport { SplashScreen } from "@/features/splash/SplashScreen";',
    );

    expect(errors).toHaveLength(3);
    expect(messages(errors)).toContain("domain may import only domain and lib modules");
  });

  it("allows the builtins listed for the git client", () => {
    const errors = importErrors(
      "src/domain/git/git.client.ts",
      'import { spawn } from "node:child_process";\nimport path from "node:path";',
    );

    expect(errors).toEqual([]);
  });

  it("allows the builtins listed for the git watcher", () => {
    const errors = importErrors(
      "src/domain/git/git.watcher.ts",
      'import { watch } from "node:fs";\nimport path from "node:path";',
    );

    expect(errors).toEqual([]);
  });

  it("rejects node:child_process in the git watcher", () => {
    const errors = importErrors(
      "src/domain/git/git.watcher.ts",
      'import { spawn } from "node:child_process";',
    );

    expect(errors).toHaveLength(1);
    expect(messages(errors)).toContain("domain must not import external packages or builtins");
  });

  it("allows the config builtins in a config module", () => {
    const errors = importErrors(
      "src/domain/config/config.loader.ts",
      'import { readFileSync } from "node:fs";\nimport os from "node:os";\nimport path from "node:path";',
    );

    expect(errors).toEqual([]);
  });

  it("rejects a Node builtin outside the per-module allowlist", () => {
    const errors = importErrors(
      "src/domain/update/update.check.ts",
      'import { readFileSync } from "node:fs";',
    );

    expect(errors).toHaveLength(1);
    expect(messages(errors)).toContain("domain must not import external packages or builtins");
  });

  it("rejects a builtin that is not listed for this domain module", () => {
    const errors = importErrors("src/domain/git/git.client.ts", 'import os from "node:os";');

    expect(errors).toHaveLength(1);
    expect(messages(errors)).toContain("domain must not import external packages or builtins");
  });
});

describe("checkImports ui layer", () => {
  it("allows React, OpenTUI, lib, theme, and ui imports", () => {
    const errors = importErrors(
      "src/ui/probe.tsx",
      'import { useState } from "react";\nimport { useKeyboard } from "@opentui/react";\nimport { parseVersion } from "@/lib/semver";\nimport { ICONS } from "@/theme/icons";\nimport { Panel } from "@/ui/Panel";',
    );

    expect(errors).toEqual([]);
  });

  it("allows ModalFrame to compose Panel and ModalActions", () => {
    const errors = importErrors(
      "src/ui/ModalFrame.tsx",
      'import { Panel } from "@/ui/Panel";\nimport { ModalActions } from "@/ui/ModalActions";',
    );

    expect(errors).toEqual([]);
  });

  it("allows ButtonRow to compose Button", () => {
    const errors = importErrors("src/ui/ButtonRow.tsx", 'import { Button } from "@/ui/Button";');

    expect(errors).toEqual([]);
  });

  it("rejects other external packages and local app, domain, or feature imports", () => {
    const errors = importErrors(
      "src/ui/probe.ts",
      'import { z } from "zod";\nimport { App } from "@/app/App";\nimport { checkForUpdate } from "@/domain/update/update.check";\nimport { SplashScreen } from "@/features/splash/SplashScreen";',
    );

    expect(errors).toHaveLength(4);
    expect(messages(errors)).toContain("ui may import only React, OpenTUI, lib, and theme modules");
  });
});

describe("checkImports feature layer", () => {
  it("allows React, OpenTUI, shared layers, its own folder, and app hooks and providers", () => {
    const errors = importErrors(
      "src/features/splash/probe.ts",
      [
        'import { useState } from "react";',
        'import { useKeyboard } from "@opentui/react";',
        'import { Panel } from "@/ui/Panel";',
        'import { checkForUpdate } from "@/domain/update/update.check";',
        'import { parseVersion } from "@/lib/semver";',
        'import { ICONS } from "@/theme/icons";',
        'import { SplashScreen } from "@/features/splash/SplashScreen";',
        'import { useAction } from "@/app/hooks/useAction";',
        'import { useConfig } from "@/app/providers/useConfig";',
      ].join("\n"),
    );

    expect(errors).toEqual([]);
  });

  it("rejects other feature folders, app modules, and provider components", () => {
    const errors = importErrors(
      "src/features/splash/probe.ts",
      [
        'import { TopBar } from "@/features/top-bar/TopBar";',
        'import { App } from "@/app/App";',
        'import { AppShellHost } from "@/app/AppShellHost";',
        'import { SplashGate } from "@/app/SplashGate";',
        'import { ConfigProvider } from "@/app/providers/ConfigProvider";',
        'import { z } from "zod";',
      ].join("\n"),
    );

    expect(errors).toHaveLength(6);
    expect(messages(errors)).toContain("feature 'splash' has an unsupported import");
  });
});

describe("checkImports test fixture exception", () => {
  it("allows a domain integration test to import the shared fixture", () => {
    const errors = importErrors(
      "src/domain/git/git.client.integration.test.ts",
      'import { createFixture } from "@/test/git.fixture";',
    );

    expect(errors).toEqual([]);
  });

  it("allows a feature test to import the shared fixture", () => {
    const errors = importErrors(
      "src/features/splash/probe.test.ts",
      'import { createFixture } from "@/test/git.fixture";',
    );

    expect(errors).toEqual([]);
  });

  it("keeps external package rules for test files", () => {
    const errors = importErrors(
      "src/domain/git/probe.test.ts",
      'import { z } from "zod";\nimport { createFixture } from "@/test/git.fixture";',
    );

    expect(errors).toHaveLength(1);
    expect(messages(errors)).toContain("domain must not import external packages ('zod')");
  });

  it("still rejects the fixture from a production module", () => {
    const errors = importErrors(
      "src/features/splash/useFixture.ts",
      'import { createFixture } from "@/test/git.fixture";',
    );

    expect(errors).toHaveLength(1);
    expect(messages(errors)).toContain("feature 'splash' has an unsupported import");
  });
});

describe("checkImports theme layer", () => {
  it("allows React including subpaths, OpenTUI, lib, theme, and any domain theme module", () => {
    const errors = importErrors(
      "src/theme/useTokens.ts",
      [
        'import { useContext } from "react";',
        'import { jsx } from "react/jsx-runtime";',
        'import { useKeyboard } from "@opentui/react";',
        'import { parseVersion } from "@/lib/semver";',
        'import { ICONS } from "@/theme/icons";',
        'import type { ThemeToken } from "@/domain/theme/theme.types";',
        'import { resolveTheme } from "@/domain/theme/theme.resolve";',
      ].join("\n"),
    );

    expect(errors).toEqual([]);
  });

  it("rejects react-dom and its subpaths under theme", () => {
    const errors = importErrors(
      "src/theme/useTokens.ts",
      'import { flushSync } from "react-dom";\nimport { createRoot } from "react-dom/client";',
    );

    expect(errors).toHaveLength(2);
    expect(messages(errors)).toContain(
      "theme may import only React, OpenTUI, lib, theme, and domain theme modules ('react-dom')",
    );
    expect(messages(errors)).toContain(
      "theme may import only React, OpenTUI, lib, theme, and domain theme modules ('react-dom/client')",
    );
  });

  it("rejects react-dom under ui and features through the shared package pattern", () => {
    const ui = importErrors("src/ui/probe.ts", 'import { createRoot } from "react-dom/client";');
    const feature = importErrors(
      "src/features/splash/probe.ts",
      'import { flushSync } from "react-dom";',
    );

    expect(ui).toHaveLength(1);
    expect(messages(ui)).toContain(
      "ui may import only React, OpenTUI, lib, and theme modules ('react-dom/client')",
    );
    expect(feature).toHaveLength(1);
    expect(messages(feature)).toContain("feature 'splash' has an unsupported import ('react-dom')");
  });

  it("rejects app, ui, features, other domain folders, and other external packages", () => {
    const errors = importErrors(
      "src/theme/useTokens.ts",
      [
        'import { readFileSync } from "node:fs";',
        'import { z } from "zod";',
        'import { App } from "@/app/App";',
        'import { Panel } from "@/ui/Panel";',
        'import { SplashScreen } from "@/features/splash/SplashScreen";',
        'import { checkForUpdate } from "@/domain/update/update.check";',
      ].join("\n"),
    );

    expect(errors).toHaveLength(6);
    expect(messages(errors)).toContain("theme may import only React, OpenTUI, lib, theme");
  });

  it("rejects a traversal alias from the theme layer", () => {
    const errors = importErrors(
      "src/theme/useTokens.ts",
      'import { App } from "@/lib/../app/App";',
    );

    expect(errors).toHaveLength(1);
    expect(messages(errors)).toContain("theme may import only React, OpenTUI, lib, theme");
  });
});

const FIXTURE_ALIAS_SPECIFIER = "@/test/git.fixture";

const TEST_ONLY_GUARD_IMPORTERS = [
  { file: "src/app/App.tsx", relativeSpecifier: "../test/git.fixture" },
  { file: "src/index.tsx", relativeSpecifier: "./test/git.fixture" },
] as const;

const FIXTURE_IMPORT_FORMS = [
  {
    label: "aliased static import",
    usesRelativeSpecifier: false,
    build: (specifier: string) => `import { createFixture } from "${specifier}";`,
  },
  {
    label: "relative static import",
    usesRelativeSpecifier: true,
    build: (specifier: string) => `import { createFixture } from "${specifier}";`,
  },
  {
    label: "require call",
    usesRelativeSpecifier: false,
    build: (specifier: string) => `const { createFixture } = require("${specifier}");`,
  },
  {
    label: "template-literal require call",
    usesRelativeSpecifier: false,
    build: (specifier: string) => `const { createFixture } = require(\`${specifier}\`);`,
  },
  {
    label: "dynamic import",
    usesRelativeSpecifier: false,
    build: (specifier: string) => `const fixture = import("${specifier}");`,
  },
  {
    label: "template-literal dynamic import",
    usesRelativeSpecifier: false,
    build: (specifier: string) => `const fixture = import(\`${specifier}\`);`,
  },
  {
    label: "re-export",
    usesRelativeSpecifier: false,
    build: (specifier: string) => `export { createFixture } from "${specifier}";`,
  },
] as const;

describe("checkImports test-only guard", () => {
  for (const importer of TEST_ONLY_GUARD_IMPORTERS) {
    for (const form of FIXTURE_IMPORT_FORMS) {
      it(`rejects a ${form.label} of the fixture from ${importer.file}`, () => {
        const specifier = form.usesRelativeSpecifier
          ? importer.relativeSpecifier
          : FIXTURE_ALIAS_SPECIFIER;
        const errors = importErrors(importer.file, form.build(specifier));

        expect(errors).toEqual([
          {
            file: importer.file,
            line: 1,
            message: `production modules must not import test-only modules ('${specifier}')`,
          },
        ]);
      });
    }
  }

  it("rejects an import-equals require of the fixture from the app layer", () => {
    const errors = importErrors(
      "src/app/probe.ts",
      'import fixture = require("@/test/git.fixture");',
    );

    expect(errors).toEqual([
      {
        file: "src/app/probe.ts",
        line: 1,
        message: "production modules must not import test-only modules ('@/test/git.fixture')",
      },
    ]);
  });

  it("rejects the exact src/test directory from the app layer", () => {
    const errors = importErrors("src/app/App.tsx", 'import { createFixture } from "@/test";');

    expect(errors).toEqual([
      {
        file: "src/app/App.tsx",
        line: 1,
        message: "production modules must not import test-only modules ('@/test')",
      },
    ]);
  });

  it("allows a colocated app test to import the fixture", () => {
    const errors = importErrors(
      "src/app/App.test.tsx",
      'import { createFixture } from "@/test/git.fixture";',
    );

    expect(errors).toEqual([]);
  });

  it("allows a colocated app test to import the exact src/test directory", () => {
    const errors = importErrors("src/app/App.test.tsx", 'import { createFixture } from "@/test";');

    expect(errors).toEqual([]);
  });

  it("allows one module under src/test to import another", () => {
    const errors = importErrors(
      "src/test/harness.ts",
      'import { createFixture } from "@/test/git.fixture";',
    );

    expect(errors).toEqual([]);
  });

  it("does not treat a test-prefixed module name as test-only", () => {
    const errors = importErrors(
      "src/app/App.tsx",
      'import { helper } from "@/test-utils/helper";\nimport { probe } from "./testing/foo";',
    );

    expect(errors).toEqual([]);
  });

  it("rejects bun:test from the app layer", () => {
    const errors = importErrors("src/app/App.tsx", 'import { test } from "bun:test";');

    expect(errors).toHaveLength(1);
    expect(messages(errors)).toContain("production modules must not import test-only modules");
  });

  it("rejects bun:test from the bootstrap entry point", () => {
    const errors = importErrors("src/index.tsx", 'import { test } from "bun:test";');

    expect(errors).toHaveLength(1);
    expect(messages(errors)).toContain("production modules must not import test-only modules");
  });

  it("rejects node:test from the app layer and the bootstrap entry point", () => {
    const app = importErrors("src/app/App.tsx", 'import { test } from "node:test";');
    const bootstrap = importErrors("src/index.tsx", 'import { test } from "node:test";');

    expect(app).toHaveLength(1);
    expect(messages(app)).toContain("production modules must not import test-only modules");
    expect(bootstrap).toHaveLength(1);
    expect(messages(bootstrap)).toContain("production modules must not import test-only modules");
  });

  it("allows a colocated app test to import bun:test", () => {
    const errors = importErrors("src/app/App.test.tsx", 'import { test } from "bun:test";');

    expect(errors).toEqual([]);
  });

  it("allows a module under src/test to import bun:test", () => {
    const errors = importErrors("src/test/harness.ts", 'import { test } from "bun:test";');

    expect(errors).toEqual([]);
  });

  it("allows a colocated test and a src/test module to import node:test", () => {
    const colocated = importErrors("src/app/App.test.tsx", 'import { test } from "node:test";');
    const harness = importErrors("src/test/harness.ts", 'import { test } from "node:test";');

    expect(colocated).toEqual([]);
    expect(harness).toEqual([]);
  });

  it("leaves the layer message as the only bun:test diagnostic", () => {
    const errors = importErrors("src/domain/probe.ts", 'import { test } from "bun:test";');

    expect(errors).toHaveLength(1);
    expect(messages(errors)).toContain("domain must not import external packages ('bun:test')");
  });
});

describe("checkImports alias normalization", () => {
  it("normalizes an alias before the layer rules run", () => {
    expect(resolveImportTarget("src/lib/probe.ts", "@/lib/../app/App")).toBe("src/app/App");
    expect(resolveImportTarget("src/lib/probe.ts", "@/../app/App")).toBeNull();
  });

  it("rejects a traversal alias from lib, a feature, and domain", () => {
    const specifier = 'import { App } from "@/lib/../app/App";';
    const lib = importErrors("src/lib/probe.ts", specifier);
    const feature = importErrors("src/features/splash/probe.ts", specifier);
    const domain = importErrors("src/domain/probe.ts", specifier);

    expect(lib).toHaveLength(1);
    expect(messages(lib)).toContain("lib may import only lib modules ('@/lib/../app/App')");
    expect(feature).toHaveLength(1);
    expect(messages(feature)).toContain("feature 'splash' has an unsupported import");
    expect(domain).toHaveLength(1);
    expect(messages(domain)).toContain("domain may import only domain and lib modules");
  });

  it("rejects an alias that escapes the source tree", () => {
    const errors = importErrors("src/lib/probe.ts", 'import { App } from "@/../app/App";');

    expect(errors).toHaveLength(1);
    expect(messages(errors)).toContain("lib may import only lib modules");
  });
});

describe("checkRawKeys", () => {
  it("flags a key name comparison outside the allowed paths", () => {
    const errors = rawKeyErrors(
      "src/app/RawKey.probe.tsx",
      'if (key.name === "c") {\n  quit();\n}',
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("raw key string comparison");
  });

  it("flags sequence and name comparisons on always key-like receivers", () => {
    const errors = rawKeyErrors(
      "src/ui/probe.ts",
      'const a = key.sequence !== "x";\nconst b = options.raw == "1";\nconst c = someKey.name === "c";',
    );

    expect(errors).toHaveLength(2);
  });

  it("does not flag ordinary error codes or non-key-aware event receivers", () => {
    const errors = rawKeyErrors(
      "src/domain/probe.ts",
      [
        'try { run(); } catch (e) { if (e.code === "ENOENT") { return; } }',
        'const a = event.code === "ArrowDown";',
        'const b = event.name === "c";',
        'const c = error.code === "ENOENT";',
        'const d = branch.name === "main";',
        'const e = options.raw === "1";',
      ].join("\n"),
    );

    expect(errors).toEqual([]);
  });

  it("flags event and short receivers only in a key-aware file", () => {
    const errors = rawKeyErrors(
      "src/app/probe.ts",
      [
        "const handler = useKeyboard;",
        'const a = event.code === "KeyC";',
        'const b = e.name === "c";',
        'const c = kbEvent.sequence === "x";',
      ].join("\n"),
    );

    expect(errors).toHaveLength(3);
  });

  it("does not flag ordinary data objects", () => {
    const errors = rawKeyErrors(
      "src/domain/probe.ts",
      'const a = error.code === "ENOENT";\nconst b = branch.name === "main";\nconst c = options.raw === "1";',
    );

    expect(errors).toEqual([]);
  });

  it("flags a bare key field only in a key-aware file", () => {
    const aware = rawKeyErrors(
      "src/app/probe.ts",
      'const handler = useKeyboard;\nconst matches = name === "c";',
    );
    const ordinary = rawKeyErrors("src/lib/probe.ts", 'const matches = name === "c";');

    expect(aware).toHaveLength(1);
    expect(ordinary).toEqual([]);
  });

  it("allows the documented quit predicate", () => {
    const errors = rawKeyErrors(
      "src/app/quit.key.ts",
      'export function isQuitKey(key) {\n  return key.ctrl && key.name.toLowerCase() === "c";\n}',
    );

    expect(errors).toEqual([]);
  });

  it("allows the keymap layer", () => {
    const errors = rawKeyErrors("src/domain/keymap/probe.ts", 'const matches = key.name === "c";');

    expect(errors).toEqual([]);
  });
});

describe("checkSpawnAndNetwork", () => {
  it("flags Bun shell, spawn, and dollar calls outside the git client", () => {
    const errors = spawnErrors(
      "src/lib/probe.ts",
      'const a = Bun.$`git status`;\nconst b = Bun.spawn(["git"]);\nconst c = Bun.shell("git status");',
    );

    expect(errors).toHaveLength(3);
    expect(messages(errors)).toContain("process spawning");
  });

  it("flags network modules, fetch, WebSocket, and Bun.connect", () => {
    const errors = spawnErrors(
      "src/ui/probe.ts",
      'import { request } from "undici";\nconst a = fetch("https://example.com");\nconst b = new WebSocket("ws://example.com");\nconst c = Bun.connect({});',
    );

    expect(errors).toHaveLength(4);
    expect(messages(errors)).toContain("network access");
  });

  it("allows network calls in the update check and spawns in the git client", () => {
    expect(
      spawnErrors(
        "src/domain/update/update.check.ts",
        'const response = await fetch("https://registry.npmjs.org");',
      ),
    ).toEqual([]);

    expect(
      spawnErrors("src/domain/git/git.client.ts", 'const child = Bun.spawn(["git", "status"]);'),
    ).toEqual([]);
  });
});

describe("checkJSDoc", () => {
  it("exempts colocated test helpers from the JSDoc rule", () => {
    const errors = boundaryErrors(
      "src/lib/probe.test.ts",
      "function undocumentedHelper() {\n  return 1;\n}",
    );

    expect(errors).toEqual([]);
  });

  it("still requires JSDoc on production helpers", () => {
    const errors = boundaryErrors(
      "src/lib/probe.ts",
      "function undocumentedHelper() {\n  return 1;\n}",
    );

    expect(errors).toHaveLength(1);
    expect(messages(errors)).toContain("missing JSDoc block");
  });
});
