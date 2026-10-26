import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import type { DiffLoadState, DiffSegment, FileDiff } from "@/domain/diff/diff.types";
import { DiffContent } from "@/features/diff/DiffContent";
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
 * @returns The renderer setup.
 */
async function renderContent(
  state: DiffLoadState,
  path: string = "src/app.ts",
): Promise<Awaited<ReturnType<typeof testRender>>> {
  const setup = await testRender(
    <ShellTestProviders>
      <box flexDirection="column" width={80} height={20}>
        <DiffContent path={path} state={state} onRetry={() => {}} />
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
