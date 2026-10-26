import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isStaleTempFile, isTempFileName } from "@/domain/config/config.atomic";

/** Temp-file prefix the writer builds for `/cfg/config.json`. */
const PREFIX = ".config.json.";

describe("isTempFileName", () => {
  it("matches this writer's digits-then-base36-token shape", () => {
    expect(isTempFileName(".config.json.1720000000000-a1b2c3.tmp", PREFIX)).toBeTrue();
    expect(isTempFileName(".config.json.1-0.tmp", PREFIX)).toBeTrue();
  });

  it("rejects differently shaped siblings and another target's temp file", () => {
    expect(isTempFileName(".config.json.notes.tmp", PREFIX)).toBeFalse();
    expect(isTempFileName(".config.json.1720000000000-.tmp", PREFIX)).toBeFalse();
    expect(isTempFileName(".config.json.-a1b2c3.tmp", PREFIX)).toBeFalse();
    expect(isTempFileName(".config.json.1720000000000-A1B2C3.tmp", PREFIX)).toBeFalse();
    expect(isTempFileName(".config.json.1720000000000-a1b2c3.bak", PREFIX)).toBeFalse();
    expect(isTempFileName(".keybindings.json.1720000000000-a1b2c3.tmp", PREFIX)).toBeFalse();
  });
});

describe("isStaleTempFile", () => {
  it("treats an old matching file as stale and a recent one as still in flight", async () => {
    const root = await mkdtemp(join(tmpdir(), "gitminal-atomic-"));
    const oldPath = join(root, ".config.json.1720000000000-stale1.tmp");
    const recentPath = join(root, ".config.json.1720000000000-recent1.tmp");
    const old = new Date(Date.now() - 5 * 60 * 1000);

    try {
      await writeFile(oldPath, "{ partial", "utf8");
      await writeFile(recentPath, "{ in flight", "utf8");
      await utimes(oldPath, old, old);

      const now = Date.now();

      expect(await isStaleTempFile(oldPath, now)).toBeTrue();
      expect(await isStaleTempFile(recentPath, now)).toBeFalse();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("marks a file just over the bound stale and one at or just under it in flight", async () => {
    const root = await mkdtemp(join(tmpdir(), "gitminal-atomic-"));
    const boundaryPath = join(root, ".config.json.1720000000000-boundary1.tmp");
    // Literal so a changed `STALE_TEMP_FILE_AGE_MS` fails this test instead of moving with it.
    const publishedAgeMs = 60_000;

    try {
      await writeFile(boundaryPath, "{ partial", "utf8");
      const base = new Date(Date.now() - 60 * 60 * 1000);

      await utimes(boundaryPath, base, base);

      // The age is derived from the file system's own `mtime`, so it is exact regardless of
      // the file system's timestamp granularity.
      const mtimeMs = (await stat(boundaryPath)).mtimeMs;

      expect(await isStaleTempFile(boundaryPath, mtimeMs + publishedAgeMs + 1)).toBeTrue();
      // Exactly the bound is still in flight: the comparison is strict `>`.
      expect(await isStaleTempFile(boundaryPath, mtimeMs + publishedAgeMs)).toBeFalse();
      expect(await isStaleTempFile(boundaryPath, mtimeMs + publishedAgeMs - 1)).toBeFalse();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("treats a missing file, which cannot be inspected, as not stale", async () => {
    const root = await mkdtemp(join(tmpdir(), "gitminal-atomic-"));
    const missingPath = join(root, ".config.json.1720000000000-gone1.tmp");

    try {
      expect(await isStaleTempFile(missingPath, Date.now())).toBeFalse();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
