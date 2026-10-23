import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { SplashScreen } from "@/features/splash/SplashScreen";
import type { UpdateCheckState } from "@/features/splash/useUpdateCheck.types";

/** Running version used by the splash tests. */
const VERSION = "0.1.0";

/** Package name used by the splash tests. */
const PACKAGE_NAME = "@im4all/gitminal";

/**
 * Reads the text of the ASCII wordmark renderable.
 *
 * @param renderable - The renderable found by id.
 * @returns The wordmark text, or `undefined` when the renderable is absent.
 */
function readAsciiFontText(renderable: unknown): string | undefined {
  if (typeof renderable !== "object" || renderable === null) {
    return undefined;
  }

  const text = (renderable as { text?: unknown }).text;

  return typeof text === "string" ? text : undefined;
}

/**
 * Counts frame lines that contain a marker.
 *
 * A marker that appears on exactly one line proves the rendered text did not wrap.
 *
 * @param frame - The captured terminal frame.
 * @param marker - The text to look for.
 * @returns The number of frame lines containing the marker.
 */
function countLinesContaining(frame: string, marker: string): number {
  return frame.split("\n").filter((line) => line.includes(marker)).length;
}

/**
 * Asserts that no rendered line is wider than the terminal.
 *
 * @param frame - The captured terminal frame.
 * @param width - The terminal width in columns.
 */
function expectLinesWithinWidth(frame: string, width: number): void {
  for (const line of frame.split("\n")) {
    expect(line.length).toBeLessThanOrEqual(width);
  }
}

/**
 * Renders the splash at the given size and returns the captured frame.
 *
 * @param width - Terminal width in columns.
 * @param height - Terminal height in rows.
 * @param update - The update view state.
 * @param version - The running version.
 * @returns The captured character frame after one render.
 */
async function captureSplashFrame(
  width: number,
  height: number,
  update: UpdateCheckState,
  version: string,
): Promise<string> {
  const setup = await testRender(
    <SplashScreen packageName={PACKAGE_NAME} version={version} update={update} />,
    { width, height },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  const frame = setup.captureCharFrame();

  await act(async () => {
    await setup.dispose();
  });

  return frame;
}

describe("SplashScreen", () => {
  it("renders the ASCII wordmark, version, checking hint, and dismiss hint", async () => {
    const setup = await testRender(
      <SplashScreen packageName={PACKAGE_NAME} version={VERSION} update={{ status: "checking" }} />,
      { width: 80, height: 24 },
    );

    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();
    const wordmark = setup.renderer.root.findDescendantById("splash-wordmark");

    expect(readAsciiFontText(wordmark)).toBe("GITMINAL");
    expect(frame).toContain(`version ${VERSION}`);
    expect(frame).toContain("Checking for updates...");
    expect(frame).toContain("Press any key to continue");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("renders the update notice and install command when an update is available", async () => {
    const update: UpdateCheckState = {
      status: "available",
      currentVersion: VERSION,
      latestVersion: "0.2.0",
    };
    const setup = await testRender(
      <SplashScreen packageName={PACKAGE_NAME} version={VERSION} update={update} />,
      { width: 80, height: 24 },
    );

    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();

    expect(frame).toContain("Update available: 0.2.0 (current 0.1.0)");
    expect(frame).toContain("Run npm i -g @im4all/gitminal");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("renders no update area for up-to-date and unavailable results", async () => {
    const results: UpdateCheckState[] = [{ status: "up-to-date" }, { status: "unavailable" }];

    for (const update of results) {
      const setup = await testRender(
        <SplashScreen packageName={PACKAGE_NAME} version={VERSION} update={update} />,
        { width: 80, height: 24 },
      );

      await act(async () => {
        await setup.renderOnce();
      });

      const frame = setup.captureCharFrame();

      expect(frame).not.toContain("Update available");
      expect(frame).not.toContain("Checking for updates...");
      expect(frame).not.toContain("npm i -g");

      await act(async () => {
        await setup.dispose();
      });
    }
  });

  it("falls back to plain bold text below 40 columns or 10 rows", async () => {
    const sizes = [
      { width: 39, height: 24 },
      { width: 80, height: 9 },
    ];

    for (const size of sizes) {
      const setup = await testRender(
        <SplashScreen
          packageName={PACKAGE_NAME}
          version={VERSION}
          update={{ status: "up-to-date" }}
        />,
        size,
      );

      await act(async () => {
        await setup.renderOnce();
      });

      const frame = setup.captureCharFrame();
      const wordmark = setup.renderer.root.findDescendantById("splash-wordmark");
      const fallback = setup.renderer.root.findDescendantById("splash-wordmark-fallback");

      expect(wordmark).toBeUndefined();
      expect(fallback).toBeDefined();
      expect(frame).toContain("GITMINAL");
      expect(frame).toContain(`version ${VERSION}`);
      expect(frame).toContain("Press any key to continue");

      await act(async () => {
        await setup.dispose();
      });
    }
  });

  it("keeps the ASCII wordmark at exactly 40 columns and 10 rows", async () => {
    const setup = await testRender(
      <SplashScreen
        packageName={PACKAGE_NAME}
        version={VERSION}
        update={{ status: "up-to-date" }}
      />,
      { width: 40, height: 10 },
    );

    await act(async () => {
      await setup.renderOnce();
    });

    const wordmark = setup.renderer.root.findDescendantById("splash-wordmark");
    const fallback = setup.renderer.root.findDescendantById("splash-wordmark-fallback");

    expect(wordmark).toBeDefined();
    expect(fallback).toBeUndefined();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the version, notice, install command, and hint on one line at narrow widths", async () => {
    const update: UpdateCheckState = {
      status: "available",
      currentVersion: "10.20.30",
      latestVersion: "10.20.31-beta.123456789",
    };
    const narrow = await captureSplashFrame(30, 10, update, "10.20.30");
    const clipped = await captureSplashFrame(20, 10, update, "10.20.30");

    expectLinesWithinWidth(narrow, 30);
    expect(countLinesContaining(narrow, "version 10.20.30")).toBe(1);
    expect(countLinesContaining(narrow, "Update available")).toBe(1);
    expect(countLinesContaining(narrow, "Run npm i -g @im4all/gitminal")).toBe(1);
    expect(countLinesContaining(narrow, "Press any key to continue")).toBe(1);

    expectLinesWithinWidth(clipped, 20);
    expect(countLinesContaining(clipped, "version 10.20.30")).toBe(1);
    expect(countLinesContaining(clipped, "Update available")).toBe(1);
    expect(countLinesContaining(clipped, "npm i -g")).toBe(1);
    expect(countLinesContaining(clipped, "Press any key")).toBe(1);
    expect(countLinesContaining(clipped, "gitminal")).toBe(0);
    expect(countLinesContaining(clipped, "Run npm")).toBe(1);
  });
});
