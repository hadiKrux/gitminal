import { describe, expect, it } from "bun:test";
import { type CapturedFrame, type CapturedSpan, RGBA } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import type { DiffLoadState, DiffSegment, FileDiff } from "@/domain/diff/diff.types";
import { THEME_FLAVORS } from "@/domain/theme/theme.catppuccin";
import { DiffContent } from "@/features/diff/DiffContent";
import { readDiffContentWidth } from "@/features/diff/diffContent.layout";
import { ShellTestProviders } from "@/test/shell.harness";

/**
 * Builds one parsed file fixture.
 *
 * @param overrides - Fields to override.
 * @returns The file diff.
 */
function fileDiff(overrides: Partial<FileDiff> = {}): FileDiff {
  return {
    path: "src/app.ts",
    oldPath: null,
    status: "modified",
    headerLines: ["diff --git a/src/app.ts b/src/app.ts"],
    hunks: [],
    binary: false,
    modeOnly: false,
    conflict: false,
    hasNoNewlineMarker: false,
    raw: "",
    ...overrides,
  };
}

/**
 * Builds one loaded cache entry.
 *
 * @param overrides - Fields to override.
 * @returns The cache entry.
 */
function loadedState(overrides: Partial<DiffLoadState> = {}): DiffLoadState {
  return {
    request: { section: "working", path: "src/app.ts", oldPath: null },
    status: "loaded",
    generation: 1,
    file: fileDiff(),
    segments: [],
    limits: null,
    message: null,
    sizeBytes: null,
    ...overrides,
  };
}

/**
 * Renders DiffContent inside the provider stack.
 *
 * @param state - Cache entry to render.
 * @param path - Row path.
 * @param themeName - Optional theme override.
 * @returns The renderer setup.
 */
async function renderContent(
  state: DiffLoadState,
  path: string = "src/app.ts",
  themeName?: string,
): Promise<Awaited<ReturnType<typeof testRender>>> {
  const setup = await testRender(
    <ShellTestProviders themeName={themeName}>
      <box flexDirection="column" width={80} height={20}>
        <DiffContent path={path} width={80} state={state} onRetry={() => {}} />
      </box>
    </ShellTestProviders>,
    { width: 90, height: 24 },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

/** One collapsed segment used by the marker test. */
const COLLAPSED_SEGMENT: DiffSegment = {
  kind: "collapsed",
  count: 42,
  oldStart: 10,
  newStart: 10,
};

/** One expanded hunk used by the theme color test. */
const DIFF_SEGMENT: DiffSegment = {
  kind: "diff",
  hunkIndex: 0,
  oldStart: 1,
  oldCount: 2,
  newStart: 1,
  newCount: 2,
  text: [
    "diff --git a/src/app.ts b/src/app.ts",
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -1,2 +1,2 @@",
    " context line",
    "-old line",
    "+new line",
  ].join("\n"),
};

/**
 * One expanded hunk whose added line starts with a TypeScript keyword.
 */
const KEYWORD_SEGMENT: DiffSegment = {
  kind: "diff",
  hunkIndex: 0,
  oldStart: 1,
  oldCount: 1,
  newStart: 1,
  newCount: 1,
  text: [
    "diff --git a/src/app.ts b/src/app.ts",
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -1,1 +1,1 @@",
    "+const value = 1;",
  ].join("\n"),
};

/**
 * Finds the first captured span whose text contains the needle.
 *
 * @param frame - Captured frame.
 * @param text - Text to find.
 * @returns The matching span.
 */
function findSpanContaining(frame: CapturedFrame, text: string): CapturedSpan {
  const span = findSpanOrNull(frame, text);

  if (span === null) {
    throw new Error(`No captured span contains ${text}`);
  }

  return span;
}

/**
 * Finds the first captured span whose text contains the needle, or null.
 *
 * @param frame - Captured frame.
 * @param text - Text to find.
 * @returns The matching span, or null when none contains the text.
 */
function findSpanOrNull(frame: CapturedFrame, text: string): CapturedSpan | null {
  for (const line of frame.lines) {
    for (const span of line.spans) {
      if (span.text.includes(text)) {
        return span;
      }
    }
  }

  return null;
}

/**
 * Polls the captured spans until one contains the text in the expected color.
 *
 * Syntax highlighting runs asynchronously after the first paint, so a color assertion has to wait
 * for the highlighter to settle instead of reading the first captured frame.
 *
 * @param setup - Renderer setup.
 * @param text - Text the span must contain.
 * @param expected - Expected foreground color.
 * @returns The matching span, or null when the deadline passes.
 */
async function waitForSpanColor(
  setup: Awaited<ReturnType<typeof testRender>>,
  text: string,
  expected: RGBA,
): Promise<CapturedSpan | null> {
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    const span = findSpanOrNull(setup.captureSpans(), text);

    if (span?.fg.equals(expected) === true) {
      return span;
    }

    await act(async () => {
      await setup.renderOnce();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }

  return null;
}

describe("DiffContent", () => {
  it("shows the loading row while the file read is in flight", async () => {
    const setup = await renderContent(loadedState({ status: "loading", file: null }));

    expect(setup.captureCharFrame()).toContain("loading diff");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows the file error with Retry", async () => {
    const setup = await renderContent(
      loadedState({ status: "error", file: null, message: "fatal: bad object" }),
    );
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Could not read diff for src/app.ts");
    expect(frame).toContain("fatal: bad object");
    expect(frame).toContain("Retry");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows the binary notice", async () => {
    const setup = await renderContent(loadedState({ status: "binary", file: null }));

    expect(setup.captureCharFrame()).toContain("Binary file - preview unavailable");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows the oversized notice with the size", async () => {
    const setup = await renderContent(
      loadedState({ status: "oversized", file: null, sizeBytes: 2 * 1024 * 1024 }),
    );
    const frame = setup.captureCharFrame();

    expect(frame).toContain("File too large to preview");
    expect(frame).toContain("2.0 MB");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("renders one unchanged-run marker for a collapsed segment", async () => {
    const setup = await renderContent(loadedState({ segments: [COLLAPSED_SEGMENT] }));

    expect(setup.captureCharFrame()).toContain("42 unchanged lines");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("uses the theme text token for diff code in a light theme", async () => {
    const setup = await renderContent(
      loadedState({ segments: [DIFF_SEGMENT] }),
      "src/app.ts",
      "catppuccin-latte",
    );
    const code = findSpanContaining(setup.captureSpans(), "context line");
    const expected = THEME_FLAVORS["catppuccin-latte"].tokens.text;

    expect(code.fg.equals(RGBA.fromHex(expected))).toBe(true);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("highlights a keyword when the filetype has a registered parser", async () => {
    const setup = await renderContent(loadedState({ segments: [KEYWORD_SEGMENT] }), "src/app.ts");
    const accent = THEME_FLAVORS["catppuccin-mocha"].tokens.accent;
    const span = await waitForSpanColor(setup, "const", RGBA.fromHex(accent));

    expect(span).not.toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the text color when no registered parser matches the filetype", async () => {
    const setup = await renderContent(loadedState({ segments: [KEYWORD_SEGMENT] }), "notes.txt");
    const text = THEME_FLAVORS["catppuccin-mocha"].tokens.text;

    await act(async () => {
      await setup.renderOnce();
      await new Promise((resolve) => setTimeout(resolve, 20));
      await setup.renderOnce();
    });

    const span = findSpanContaining(setup.captureSpans(), "const");

    expect(span.fg.equals(RGBA.fromHex(text))).toBe(true);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("renders the truncation notice with shown and total lines", async () => {
    const setup = await renderContent(
      loadedState({
        limits: {
          text: "",
          truncated: true,
          totalLines: 900,
          shownLines: 400,
          totalBytes: 9000,
          shownBytes: 4000,
        },
      }),
    );
    const frame = setup.captureCharFrame();

    expect(frame).toContain("diff truncated - showing 400 of 900 lines");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("renders a metadata-only change", async () => {
    const setup = await renderContent(
      loadedState({
        file: fileDiff({
          modeOnly: true,
          headerLines: ["old mode 100644", "new mode 100755"],
        }),
      }),
    );
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Mode change only");
    expect(frame).toContain("old mode 100644");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("renders a synthetic conflict patch with visible markers", async () => {
    const setup = await renderContent(
      loadedState({
        file: fileDiff({
          conflict: true,
          headerLines: ["diff --git a/conflict.txt b/conflict.txt"],
        }),
        segments: [
          {
            kind: "diff",
            hunkIndex: 0,
            oldStart: 1,
            oldCount: 7,
            newStart: 1,
            newCount: 7,
            text: [
              "diff --git a/conflict.txt b/conflict.txt",
              "--- a/conflict.txt",
              "+++ b/conflict.txt",
              "@@ -1,7 +1,7 @@",
              " context",
              "<<<<<<< HEAD",
              " ours",
              "=======",
              " theirs",
              ">>>>>>> feature",
              " tail",
            ].join("\n"),
          },
        ],
      }),
    );
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Conflicted file");
    expect(frame).toContain("<<<<<<< HEAD");
    expect(frame).toContain("ours");

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("readDiffContentWidth", () => {
  /** A short hunk whose rendered lines all fit a narrow panel. */
  const SHORT_PATCH = [
    "diff --git a/src/app.ts b/src/app.ts",
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -1,1 +1,1 @@",
    "-old",
    "+new",
  ].join("\n");

  /** A hunk with one line wider than the measured panel. */
  const LONG_PATCH = [
    "diff --git a/src/app.ts b/src/app.ts",
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -1,0 +1,1 @@",
    `+${"x".repeat(200)}`,
  ].join("\n");

  /**
   * Builds a patch with one 200-cell added line under the given hunk header.
   *
   * @param header - Hunk header line.
   * @returns The unified patch text.
   */
  function longPatchWithHeader(header: string): string {
    return [
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      header,
      `+${"x".repeat(200)}`,
    ].join("\n");
  }

  it("keeps a short patch at the measured width", () => {
    expect(readDiffContentWidth(SHORT_PATCH, 40)).toBe(40);
  });

  it("widens a long patch line past the measured width", () => {
    expect(readDiffContentWidth(LONG_PATCH, 40)).toBeGreaterThan(40);
  });

  it("adds the exact five-cell gutter to a long patch line", () => {
    expect(readDiffContentWidth(LONG_PATCH, 40)).toBe(205);
  });

  it("widens the gutter for a hunk starting at a four-digit line number", () => {
    expect(readDiffContentWidth(longPatchWithHeader("@@ -999,5 +999,5 @@"), 40)).toBe(208);
  });

  it("widens the gutter when the hunk numbers roll over to two digits", () => {
    expect(readDiffContentWidth(longPatchWithHeader("@@ -9,5 +9,5 @@"), 40)).toBe(206);
  });

  it("reads the omitted-count hunk form as a one-line range", () => {
    expect(readDiffContentWidth(longPatchWithHeader("@@ -1 +1 @@"), 40)).toBe(205);
  });

  it("uses the largest line number across every hunk header", () => {
    const patch = [
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,2 +1,2 @@",
      "-old",
      "+new",
      "@@ -1200,3 +1200,3 @@",
      `+${"x".repeat(200)}`,
    ].join("\n");

    expect(readDiffContentWidth(patch, 40)).toBe(208);
  });

  it("keeps a patch without a hunk header at the measured width", () => {
    const headerOnlyPatch = [
      "diff --git a/src/app.ts b/src/app.ts",
      "index 1234567..89abcde 100644",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
    ].join("\n");

    expect(readDiffContentWidth(headerOnlyPatch, 40)).toBe(40);
    expect(readDiffContentWidth(headerOnlyPatch, 0)).toBe(0);
  });

  it("ignores a long path in the patch header", () => {
    const header = `diff --git a/${"deep/".repeat(30)}file.txt b/${"deep/".repeat(30)}file.txt`;
    const lines = [header, "--- a/file.txt", "+++ b/file.txt", "@@ -1,1 +1,1 @@", "+new"];
    const patch = lines.join("\n");

    expect(readDiffContentWidth(patch, 40)).toBe(40);
  });

  it("expands tabs to the fixed tab stop before measuring", () => {
    const tabbedPatch = [
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,0 +1,1 @@",
      `+\t\t${"y".repeat(20)}`,
    ].join("\n");
    const spacedPatch = tabbedPatch.replace("+\t\t", `+${" ".repeat(8)}`);

    expect(readDiffContentWidth(tabbedPatch, 10)).toBe(readDiffContentWidth(spacedPatch, 10));
  });
});
