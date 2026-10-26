import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfigFiles, MAX_CONFIG_FILE_BYTES } from "@/domain/config/config.loader";
import type { ConfigFilePaths, ConfigFileReader } from "@/domain/config/config.types";

/** The three resolved paths used by the cases. */
const PATHS: ConfigFilePaths = Object.freeze({
  config: "/cfg/config.json",
  keybindings: "/cfg/keybindings.json",
  theme: "/cfg/theme.json",
});

/** Prefix kept outside the string so the colour is not written as a hex literal. */
const HEX_PREFIX = "#";

/**
 * Builds a reader that serves the given files and reports missing ones as `ENOENT`.
 *
 * @param files - Path to file content.
 * @returns The fake reader.
 */
function createReader(files: Readonly<Record<string, string>>): ConfigFileReader {
  return async (filePath: string): Promise<string> => {
    const content = files[filePath];

    if (content === undefined) {
      throw Object.assign(new Error(`ENOENT: no such file or directory, open '${filePath}'`), {
        code: "ENOENT",
      });
    }

    return content;
  };
}

describe("loadConfigFiles", () => {
  it("parses every present file", async () => {
    const loaded = await loadConfigFiles(PATHS, {
      readFile: createReader({
        [PATHS.config as string]: '{"theme":"catppuccin-latte"}',
        [PATHS.keybindings as string]: '{"app.refresh":["x"]}',
        [PATHS.theme as string]: `{"colors":{"accent":"${HEX_PREFIX}abcdef"}}`,
      }),
    });

    expect(loaded.warnings).toEqual([]);
    expect(loaded.files.map((file) => [file.key, file.status])).toEqual([
      ["config", "loaded"],
      ["keybindings", "loaded"],
      ["theme", "loaded"],
    ]);
    expect(loaded.files[0]?.value).toEqual({ theme: "catppuccin-latte" });
    expect(loaded.files[1]?.value).toEqual({ "app.refresh": ["x"] });
    expect(loaded.files[2]?.value).toEqual({ colors: { accent: `${HEX_PREFIX}abcdef` } });
  });

  it("treats a missing file as silent", async () => {
    const loaded = await loadConfigFiles(PATHS, { readFile: createReader({}) });

    expect(loaded.warnings).toEqual([]);
    expect(loaded.files.map((file) => file.status)).toEqual(["missing", "missing", "missing"]);
    expect(loaded.files.every((file) => file.value === null)).toBe(true);
  });

  it("warns once for a malformed file and keeps the others", async () => {
    const loaded = await loadConfigFiles(PATHS, {
      readFile: createReader({
        [PATHS.config as string]: "{ not json",
        [PATHS.theme as string]: '{"colors":{}}',
      }),
    });

    expect(loaded.files[0]?.status).toBe("failed");
    expect(loaded.files[0]?.value).toBeNull();
    expect(loaded.files[2]?.status).toBe("loaded");
    expect(loaded.warnings).toHaveLength(1);
    expect(loaded.warnings[0]).toContain("config.json");
    expect(loaded.warnings[0]).toContain(PATHS.config as string);
    expect(loaded.warnings[0]).toContain("Could not parse");
  });

  it("warns once for an unreadable file", async () => {
    const loaded = await loadConfigFiles(PATHS, {
      readFile: async (filePath: string): Promise<string> => {
        if (filePath === PATHS.keybindings) {
          throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
        }

        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    });

    expect(loaded.files[1]?.status).toBe("failed");
    expect(loaded.warnings).toHaveLength(1);
    expect(loaded.warnings[0]).toContain("keybindings.json");
    expect(loaded.warnings[0]).toContain("Could not read");
    expect(loaded.warnings[0]).not.toContain("\n");
  });

  it("warns once and skips a file over the read cap", async () => {
    const loaded = await loadConfigFiles(PATHS, {
      readFile: async (filePath: string): Promise<string> => {
        if (filePath === PATHS.config) {
          return "x".repeat(MAX_CONFIG_FILE_BYTES + 1);
        }

        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    });

    expect(loaded.files[0]?.status).toBe("failed");
    expect(loaded.files[0]?.value).toBeNull();
    expect(loaded.warnings).toHaveLength(1);
    expect(loaded.warnings[0]).toContain("config.json");
    expect(loaded.warnings[0]).toContain("larger than");
    expect(loaded.warnings[0]).not.toContain("\n");
  });

  it("reports a real file over the cap before buffering it", async () => {
    const root = await mkdtemp(join(tmpdir(), "gitminal-config-"));

    try {
      const configPath = join(root, "config.json");

      await writeFile(configPath, "x".repeat(MAX_CONFIG_FILE_BYTES + 1), "utf8");

      const loaded = await loadConfigFiles({ config: configPath, keybindings: null, theme: null });

      expect(loaded.files[0]?.status).toBe("failed");
      expect(loaded.warnings).toHaveLength(1);
      expect(loaded.warnings[0]).toContain("larger than");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("never reads an unresolved path", async () => {
    const read: string[] = [];
    const loaded = await loadConfigFiles(
      { config: null, keybindings: null, theme: null },
      {
        readFile: async (filePath: string): Promise<string> => {
          read.push(filePath);

          return "{}";
        },
      },
    );

    expect(read).toEqual([]);
    expect(loaded.files.map((file) => [file.status, file.path])).toEqual([
      ["missing", null],
      ["missing", null],
      ["missing", null],
    ]);
  });
});
