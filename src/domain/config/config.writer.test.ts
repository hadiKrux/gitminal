import { describe, expect, it } from "bun:test";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG_VERSION } from "@/domain/config/config.defaults";
import { MAX_CONFIG_FILE_BYTES } from "@/domain/config/config.loader";
import { writeTheme } from "@/domain/config/config.writer";

/** Config path used by the cases. */
const CONFIG_PATH = "/cfg/config.json";

/** True when the host can create a symbolic link; Windows requires a privilege for it. */
const symlinkHost = process.platform !== "win32";

/** True when the host enforces directory permissions for this process; root and Windows do not. */
const permissionHost = symlinkHost && process.getuid?.() !== 0;

/**
 * Builds an `ENOENT` failure the way the filesystem reports a missing file.
 *
 * @returns The error to throw.
 */
function missingFileError(): Error {
  return Object.assign(new Error(`ENOENT: no such file or directory, open '${CONFIG_PATH}'`), {
    code: "ENOENT",
  });
}

/**
 * Reads the content a writer captured.
 *
 * @param written - Captured writes.
 * @returns The single written payload.
 */
function readWritten(written: readonly string[]): unknown {
  expect(written).toHaveLength(1);

  return JSON.parse(written[0] ?? "");
}

describe("writeTheme", () => {
  it("writes only the theme field and preserves every other field", async () => {
    const written: string[] = [];
    const existing = {
      version: 1,
      theme: "catppuccin-mocha",
      git: { path: "/usr/bin/git" },
      keybindings: { "app.refresh": ["x"] },
      custom: "kept",
    };
    const result = await writeTheme("catppuccin-latte", {
      configPath: CONFIG_PATH,
      readFile: async (): Promise<string> => JSON.stringify(existing),
      writeFile: async (_path: string, content: string): Promise<void> => {
        written.push(content);
      },
    });

    expect(result).toEqual({ ok: true });
    expect(readWritten(written)).toEqual({ ...existing, theme: "catppuccin-latte" });
  });

  it("creates a minimal configuration when the file does not exist", async () => {
    const written: string[] = [];
    const result = await writeTheme("catppuccin-frappe", {
      configPath: CONFIG_PATH,
      readFile: async (): Promise<string> => {
        throw missingFileError();
      },
      writeFile: async (_path: string, content: string): Promise<void> => {
        written.push(content);
      },
    });

    expect(result).toEqual({ ok: true });
    expect(readWritten(written)).toEqual({
      version: DEFAULT_CONFIG_VERSION,
      theme: "catppuccin-frappe",
    });
  });

  it("leaves the file untouched when it cannot be written", async () => {
    const attempted: string[] = [];
    const result = await writeTheme("catppuccin-latte", {
      configPath: CONFIG_PATH,
      readFile: async (): Promise<string> => JSON.stringify({ theme: "catppuccin-mocha" }),
      writeFile: async (filePath: string): Promise<void> => {
        attempted.push(filePath);

        throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
      },
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Could not write");
    expect(result.reason).toContain(CONFIG_PATH);
    expect(attempted).toEqual([CONFIG_PATH]);
  });

  it("refuses to rewrite an oversized file", async () => {
    const written: string[] = [];
    const result = await writeTheme("catppuccin-latte", {
      configPath: CONFIG_PATH,
      readFile: async (): Promise<string> => "x".repeat(MAX_CONFIG_FILE_BYTES + 1),
      writeFile: async (_path: string, content: string): Promise<void> => {
        written.push(content);
      },
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("larger than");
    expect(written).toEqual([]);
  });

  it("refuses to rewrite a malformed file", async () => {
    const written: string[] = [];
    const result = await writeTheme("catppuccin-latte", {
      configPath: CONFIG_PATH,
      readFile: async (): Promise<string> => "{ not json",
      writeFile: async (_path: string, content: string): Promise<void> => {
        written.push(content);
      },
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("malformed");
    expect(written).toEqual([]);
  });

  it("refuses to rewrite a file that is not an object", async () => {
    const written: string[] = [];
    const result = await writeTheme("catppuccin-latte", {
      configPath: CONFIG_PATH,
      readFile: async (): Promise<string> => "[1,2,3]",
      writeFile: async (_path: string, content: string): Promise<void> => {
        written.push(content);
      },
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("not a JSON object");
    expect(written).toEqual([]);
  });

  it("creates a missing configuration directory and leaves no temp file behind", async () => {
    const root = await mkdtemp(join(tmpdir(), "gitminal-config-"));

    try {
      const configPath = join(root, "gitminal", "config.json");
      const result = await writeTheme("catppuccin-frappe", { configPath });

      expect(result).toEqual({ ok: true });
      expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({
        version: DEFAULT_CONFIG_VERSION,
        theme: "catppuccin-frappe",
      });
      expect(await readdir(join(root, "gitminal"))).toEqual(["config.json"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns a failure without throwing when the parent path is not a directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "gitminal-config-"));

    try {
      const blocker = join(root, "blocked");

      await writeFile(blocker, "not a directory", "utf8");

      const result = await writeTheme("catppuccin-latte", {
        configPath: join(blocker, "config.json"),
        readFile: async (): Promise<string> => {
          throw missingFileError();
        },
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toContain("Could not write");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps the original file and removes the temp file when the rename fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "gitminal-config-"));
    const configPath = join(root, "config.json");
    const original = `${JSON.stringify({ theme: "catppuccin-mocha" }, null, 2)}\n`;

    try {
      await writeFile(configPath, original, "utf8");

      const result = await writeTheme("catppuccin-latte", {
        configPath,
        renameFile: async (): Promise<void> => {
          throw Object.assign(new Error("EIO: rename failed"), { code: "EIO" });
        },
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toContain("Could not write");
      expect(await readFile(configPath, "utf8")).toBe(original);
      expect(await readdir(root)).toEqual(["config.json"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when no config path can be resolved", async () => {
    const result = await writeTheme("catppuccin-latte", {
      env: {},
      homeDir: "",
      platform: "linux",
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("No config.json location could be resolved");
  });
});

describe.skipIf(!symlinkHost)("writeTheme symlink handling", () => {
  it("writes through a symlinked config and keeps the link a symlink", async () => {
    const root = await mkdtemp(join(tmpdir(), "gitminal-config-"));
    const dotfiles = join(root, "dotfiles");
    const linkPath = join(root, "config.json");
    const targetPath = join(dotfiles, "config.json");

    try {
      await mkdir(dotfiles, { recursive: true });
      await writeFile(targetPath, `${JSON.stringify({ theme: "catppuccin-mocha" })}\n`, "utf8");
      await symlink(targetPath, linkPath);

      const result = await writeTheme("catppuccin-latte", { configPath: linkPath });

      expect(result).toEqual({ ok: true });
      expect((await lstat(linkPath)).isSymbolicLink()).toBeTrue();
      expect(JSON.parse(await readFile(targetPath, "utf8"))).toEqual({
        theme: "catppuccin-latte",
      });
      expect(await readdir(dotfiles)).toEqual(["config.json"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("writes through a dangling symlink into a missing directory and keeps the link a symlink", async () => {
    const root = await mkdtemp(join(tmpdir(), "gitminal-config-"));
    const dotfiles = join(root, "dotfiles");
    const linkPath = join(root, "config.json");
    const targetPath = join(dotfiles, "config.json");
    const linkTarget = join("dotfiles", "config.json");

    try {
      await symlink(linkTarget, linkPath);

      const result = await writeTheme("catppuccin-latte", { configPath: linkPath });

      expect(result).toEqual({ ok: true });
      expect((await lstat(linkPath)).isSymbolicLink()).toBeTrue();
      expect(await readlink(linkPath)).toBe(linkTarget);
      expect(JSON.parse(await readFile(targetPath, "utf8"))).toEqual({
        version: DEFAULT_CONFIG_VERSION,
        theme: "catppuccin-latte",
      });
      expect(await readdir(dotfiles)).toEqual(["config.json"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("writeTheme stale temp files", () => {
  it("removes a matching temp file older than the age bound and leaves other files alone", async () => {
    const root = await mkdtemp(join(tmpdir(), "gitminal-config-"));
    const configPath = join(root, "config.json");
    const stalePath = join(root, ".config.json.1720000000000-stale1.tmp");
    const unrelatedPath = join(root, "notes.txt");
    const old = new Date(Date.now() - 5 * 60 * 1000);

    try {
      await writeFile(configPath, `${JSON.stringify({ theme: "catppuccin-mocha" })}\n`, "utf8");
      await writeFile(stalePath, "{ partial", "utf8");
      await writeFile(unrelatedPath, "keep me", "utf8");
      await utimes(stalePath, old, old);

      const result = await writeTheme("catppuccin-latte", { configPath });

      expect(result).toEqual({ ok: true });
      expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({
        theme: "catppuccin-latte",
      });
      expect((await readdir(root)).sort()).toEqual(["config.json", "notes.txt"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps a recent matching temp file and a differently shaped sibling", async () => {
    const root = await mkdtemp(join(tmpdir(), "gitminal-config-"));
    const configPath = join(root, "config.json");
    const recentName = `.config.json.${Date.now()}-recent1.tmp`;
    const recentPath = join(root, recentName);
    const notesPath = join(root, ".config.json.notes.tmp");
    const oldPath = join(root, ".config.json.1720000000000-stale1.tmp");
    const old = new Date(Date.now() - 5 * 60 * 1000);

    try {
      await writeFile(configPath, `${JSON.stringify({ theme: "catppuccin-mocha" })}\n`, "utf8");
      await writeFile(recentPath, "{ in flight", "utf8");
      await writeFile(notesPath, "user notes", "utf8");
      await writeFile(oldPath, "{ partial", "utf8");
      await utimes(oldPath, old, old);
      // Back-dated too, so only the temp-name shape check can keep this sibling.
      await utimes(notesPath, old, old);

      const result = await writeTheme("catppuccin-latte", { configPath });
      const entries = await readdir(root);

      expect(result).toEqual({ ok: true });
      expect(entries).toContain("config.json");
      expect(entries).toContain(recentName);
      expect(entries).toContain(".config.json.notes.tmp");
      expect(entries).not.toContain(".config.json.1720000000000-stale1.tmp");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!permissionHost)("writeTheme read-only directory", () => {
  it("fails without touching the original file when the directory is not writable", async () => {
    const root = await mkdtemp(join(tmpdir(), "gitminal-config-"));
    const configPath = join(root, "config.json");
    const original = `${JSON.stringify({ theme: "catppuccin-mocha" }, null, 2)}\n`;

    try {
      await writeFile(configPath, original, "utf8");
      await chmod(root, 0o500);

      const result = await writeTheme("catppuccin-latte", { configPath });

      expect(result.ok).toBe(false);
      expect(result.reason).toContain("Could not write");
      expect(await readFile(configPath, "utf8")).toBe(original);
    } finally {
      await chmod(root, 0o700);
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("writeTheme mode handling", () => {
  it("keeps the mode of an existing config file", async () => {
    const root = await mkdtemp(join(tmpdir(), "gitminal-config-"));
    const configPath = join(root, "config.json");

    try {
      await writeFile(configPath, `${JSON.stringify({ theme: "catppuccin-mocha" })}\n`, "utf8");
      await chmod(configPath, 0o600);

      const result = await writeTheme("catppuccin-latte", { configPath });

      expect(result).toEqual({ ok: true });
      expect((await stat(configPath)).mode & 0o777).toBe(0o600);
      expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({
        theme: "catppuccin-latte",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
