import { describe, expect, it } from "bun:test";
import {
  type Renderable,
  type ScrollBoxRenderable,
  ScrollBoxRenderable as ScrollBoxRenderableClass,
} from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import type { RemoteFreshness } from "@/domain/repository/repository.types";
import { RemoteRow } from "@/features/remotes/RemoteRow";
import { REMOTE_ROW_STALE_INDICATOR } from "@/features/remotes/RemoteRow.constants";
import { ShellTestProviders, SidebarFrameHarness } from "@/test/shell.harness";
import { ICONS } from "@/theme/icons";
import { PANEL_BORDER_WIDTH } from "@/ui/Panel.constants";

/** Long branch name that cannot fit either sidebar content width. */
const LONG_BRANCH = "feature/a-very-long-remote-branch-name";

/** Filler rows that make the panel overflow so the vertical scrollbar is drawn. */
const FILLER_ROWS: readonly string[] = Array.from({ length: 29 }, (_, index) => `filler ${index}`);

/**
 * Renders one remote row at a requested terminal width.
 *
 * @param freshness - Freshness classification for the row.
 * @param width - Terminal width in cells.
 * @param branch - Branch name to render.
 * @returns The captured character frame.
 */
async function renderRow(
  freshness: RemoteFreshness,
  width: number,
  branch: string = "main",
  remote: string = "origin",
  hasLocalTracker: boolean = false,
): Promise<string> {
  const setup = await testRender(
    <ShellTestProviders>
      <box flexDirection="column" width={Math.min(width, 28)} height={4}>
        <RemoteRow
          id="remote-row-origin-main"
          remote={remote}
          hasLocalTracker={hasLocalTracker}
          branch={branch}
          freshness={freshness}
          selected
          focused
          onMouseDown={() => {}}
        />
      </box>
    </ShellTestProviders>,
    { width, height: 6 },
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

/**
 * Renders the row that opens a panel body followed by enough rows to overflow the frame.
 *
 * @param props - Freshness and branch name for the first row.
 * @returns The overflowing panel body.
 */
function OverflowingRows(props: {
  readonly freshness: RemoteFreshness;
  readonly branch: string;
  readonly hasLocalTracker?: boolean;
}): ReactNode {
  return (
    <box flexDirection="column" flexShrink={0}>
      <RemoteRow
        id="remote-row-origin-main"
        remote="origin"
        branch={props.branch}
        hasLocalTracker={props.hasLocalTracker}
        freshness={props.freshness}
        selected
        focused
        onMouseDown={() => {}}
      />
      {FILLER_ROWS.map((row) => (
        <text key={row} wrapMode="none">
          {row}
        </text>
      ))}
    </box>
  );
}

/**
 * Renders one remote row in the real panel frame with enough rows to show a scrollbar.
 *
 * @param freshness - Freshness classification for the first row.
 * @param sidebarWidth - Bordered sidebar width in cells.
 * @param branch - Branch name to render.
 * @returns The frame and the panel's scroll container.
 */
async function renderFramedRow(
  freshness: RemoteFreshness,
  sidebarWidth: number,
  branch: string,
  hasLocalTracker: boolean = false,
): Promise<{ readonly frame: string; readonly scrollBox: ScrollBoxRenderable }> {
  const setup = await testRender(
    <SidebarFrameHarness
      regionId="remotes"
      label="Remotes (30)"
      width={sidebarWidth}
      height={10}
      contentWidth={sidebarWidth - PANEL_BORDER_WIDTH}
      content={
        <OverflowingRows freshness={freshness} branch={branch} hasLocalTracker={hasLocalTracker} />
      }
    />,
    { width: sidebarWidth, height: 10 },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  const frame = setup.captureCharFrame();
  const scrollBox = findScrollBox(setup.renderer.root);

  await act(async () => {
    await setup.dispose();
  });

  return { frame, scrollBox };
}

/**
 * Finds the panel's scroll container.
 *
 * @param renderable - Renderable to inspect.
 * @returns The scrollbox, or a failure when the frame has none.
 */
function findScrollBox(renderable: Renderable): ScrollBoxRenderable {
  const found = tryFindScrollBox(renderable);

  if (found === undefined) {
    throw new Error("the panel frame rendered no scrollbox");
  }

  return found;
}

/**
 * Searches one renderable subtree for a scrollbox.
 *
 * @param renderable - Renderable to inspect.
 * @returns The scrollbox, or undefined when this subtree has none.
 */
function tryFindScrollBox(renderable: Renderable): ScrollBoxRenderable | undefined {
  if (renderable instanceof ScrollBoxRenderableClass) {
    return renderable;
  }

  for (const child of renderable.getChildren()) {
    const found = tryFindScrollBox(child);

    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}

/**
 * Reads the frame line that carries the freshness marker.
 *
 * @param frame - Captured character frame.
 * @returns The row text.
 */
function readMarkerLine(frame: string): string {
  const line = frame
    .split("\n")
    .find((candidate) => candidate.includes(REMOTE_ROW_STALE_INDICATOR));

  if (line === undefined) {
    throw new Error("the freshness marker is missing");
  }

  return line;
}

describe("RemoteRow", () => {
  it("prefixes a tracked branch once without adding its remote name", async () => {
    const frame = await renderRow("fresh", 80, "main", "upstream", true);
    expect(frame).toContain(`${ICONS.remoteLocalTracker} main`);
    expect(frame.split(ICONS.remoteLocalTracker)).toHaveLength(2);
    expect(frame).not.toContain("upstream/");
  });

  it.each([
    { width: 26, name: "feature..." },
    { width: 20, name: "f..." },
  ])("reserves tracker and freshness marker widths at $width columns", async ({ width, name }) => {
    const { frame, scrollBox } = await renderFramedRow("stale", width, LONG_BRANCH, true);
    expect(scrollBox.scrollHeight).toBeGreaterThan(scrollBox.height);
    expect(readMarkerLine(frame)).toContain(
      `${ICONS.remoteLocalTracker} ${name} ${REMOTE_ROW_STALE_INDICATOR}`,
    );
    expect(frame).not.toContain(LONG_BRANCH);
  });

  it.each(["origin", "upstream", "team/upstream"])(
    "shows only the branch name within the %s group",
    async (remote) => {
      const frame = await renderRow("fresh", 80, "feature/nested", remote);

      expect(frame).toContain(" feature/nested");
      expect(frame).not.toContain(`${remote}/`);
      expect(frame).not.toContain(ICONS.remoteLocalTracker);
      expect(frame).not.toContain(ICONS.selected);
      expect(frame).not.toContain(REMOTE_ROW_STALE_INDICATOR);
      expect(frame).not.toContain(ICONS.missingUpstream);
    },
  );

  it("marks a stale remote inline with the stale indicator", async () => {
    const frame = await renderRow("stale", 80);

    expect(frame).toContain(" main");
    expect(frame).not.toContain("origin/");
    expect(frame).toContain(REMOTE_ROW_STALE_INDICATOR);
  });

  it("marks an unknown remote inline without claiming absence", async () => {
    const frame = await renderRow("unknown", 80);

    expect(frame).toContain(" main");
    expect(frame).not.toContain("origin/");
    expect(frame).toContain(ICONS.missingUpstream);
    expect(frame).not.toContain("deleted");
    expect(frame).not.toContain("unpushed");
  });

  it("keeps the name visible on a narrow terminal", async () => {
    const frame = await renderRow("fresh", 30);

    expect(frame).not.toContain("origin/");
    expect(frame).toContain("main");
  });

  it("keeps the name, separator, and freshness marker inside the full-width frame with a scrollbar", async () => {
    const { frame, scrollBox } = await renderFramedRow("stale", 26, LONG_BRANCH);

    expect(scrollBox.scrollHeight).toBeGreaterThan(scrollBox.height);
    expect(readMarkerLine(frame)).toContain(" feature/a-v... [stale]");
    expect(frame).not.toContain(ICONS.selected);
    expect(frame).not.toContain("filler 28");
    expect(frame).not.toContain(LONG_BRANCH);
  });

  it("keeps the name, separator, and freshness marker inside the narrow frame with a scrollbar", async () => {
    const { frame, scrollBox } = await renderFramedRow("stale", 20, LONG_BRANCH);

    expect(scrollBox.scrollHeight).toBeGreaterThan(scrollBox.height);
    expect(readMarkerLine(frame)).toContain(" featu... [stale]");
    expect(frame).not.toContain("filler 28");
    expect(frame).not.toContain(LONG_BRANCH);
  });
});
