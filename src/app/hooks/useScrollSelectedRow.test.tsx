import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { Renderable, ScrollBoxRenderable } from "@opentui/core";
import { ScrollBoxRenderable as ScrollBoxRenderableClass } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode, useState } from "react";
import { useScrollSelectedRow } from "@/app/hooks/useScrollSelectedRow";
import type { SidebarPanel } from "@/features/shell/focus.types";
import { SidebarPanelFrame } from "@/features/shell/SidebarPanelFrame";
import { ShellTestProviders } from "@/test/shell.harness";

const ROW_COUNT = 30;
const ROW_IDS = Array.from({ length: ROW_COUNT }, (_, index) => `row-${index}`);

let setActiveId: (id: string | null) => void = () => {};
let forceRender: () => void = () => {};
let insertRowAbove: () => void = () => {};

/**
 * Renders a row set and keeps the active row in view through the shell scroll container.
 *
 * @param props - Rows to render, the active row id, and its current index.
 * @returns The panel body rows.
 */
function RowList(props: {
  readonly rows: readonly string[];
  readonly activeId: string | null;
  readonly revision: number;
}): ReactNode {
  useScrollSelectedRow(props.activeId, props.revision);

  return (
    <box flexDirection="column" flexShrink={0}>
      {props.rows.map((rowId) => (
        <box id={rowId} key={rowId} height={1} flexShrink={0}>
          <text>{rowId}</text>
        </box>
      ))}
    </box>
  );
}

/**
 * Hosts the panel frame and exposes the harness controls the tests drive.
 *
 * @returns The framed panel.
 */
function Harness(): ReactNode {
  const [rows, setRows] = useState<readonly string[]>(ROW_IDS);
  const [activeId, setActive] = useState<string | null>("row-0");
  const [, setTick] = useState(0);

  setActiveId = setActive;
  forceRender = () => setTick((tick) => tick + 1);
  insertRowAbove = () => {
    setRows((current) => [`inserted-${current.length}`, ...current]);
  };

  const panel: SidebarPanel = {
    regionId: "branches",
    label: "Branches",
    content: (
      <RowList
        rows={rows}
        activeId={activeId}
        revision={activeId === null ? -1 : rows.indexOf(activeId)}
      />
    ),
  };

  return <SidebarPanelFrame panel={panel} contentWidth={38} flexGrow={1} />;
}

/**
 * Renders the harness at a height that makes the row list overflow.
 *
 * @returns The renderer setup.
 */
async function renderHarness(): Promise<Awaited<ReturnType<typeof testRender>>> {
  const setup = await testRender(
    <ShellTestProviders>
      <box flexDirection="column" width={40} height={10}>
        <Harness />
      </box>
    </ShellTestProviders>,
    {
      width: 40,
      height: 10,
    },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

/**
 * Finds the single scrollbox the frame rendered.
 *
 * @param renderable - Renderable to inspect.
 * @returns The scrollbox, or `undefined` when this subtree has none.
 */
function findScrollBox(renderable: Renderable): ScrollBoxRenderable | undefined {
  if (renderable instanceof ScrollBoxRenderableClass) {
    return renderable;
  }

  for (const child of renderable.getChildren()) {
    const found = findScrollBox(child);

    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}

beforeEach(() => {
  setActiveId = () => {};
  forceRender = () => {};
  insertRowAbove = () => {};
});

describe("useScrollSelectedRow", () => {
  it("scrolls a newly selected row into the panel viewport", async () => {
    const setup = await renderHarness();
    const scrollBox = findScrollBox(setup.renderer.root);

    expect(scrollBox).toBeDefined();
    expect(scrollBox?.scrollTop).toBe(0);

    await act(async () => {
      setActiveId("row-25");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    const row = scrollBox?.content.findDescendantById("row-25");
    expect(row).toBeDefined();
    expect(scrollBox?.scrollTop).toBeGreaterThan(0);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("scrolls once per active id, not on every render", async () => {
    const setup = await renderHarness();
    const scrollBox = findScrollBox(setup.renderer.root);

    expect(scrollBox).toBeDefined();
    const scrollChildIntoView = spyOn(scrollBox as ScrollBoxRenderable, "scrollChildIntoView");

    await act(async () => {
      forceRender();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(scrollChildIntoView).not.toHaveBeenCalled();

    await act(async () => {
      setActiveId("row-12");
    });

    expect(scrollChildIntoView).toHaveBeenCalledTimes(1);
    expect(scrollChildIntoView).toHaveBeenCalledWith("row-12");

    await act(async () => {
      forceRender();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(scrollChildIntoView).toHaveBeenCalledTimes(1);

    scrollChildIntoView.mockRestore();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("re-scrolls an unchanged selected row after rows are inserted above it", async () => {
    const setup = await renderHarness();
    const scrollBox = findScrollBox(setup.renderer.root);

    expect(scrollBox).toBeDefined();
    const scrollChildIntoView = spyOn(scrollBox as ScrollBoxRenderable, "scrollChildIntoView");

    await act(async () => {
      setActiveId("row-12");
    });

    expect(scrollChildIntoView).toHaveBeenCalledTimes(1);

    await act(async () => {
      insertRowAbove();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(scrollChildIntoView).toHaveBeenCalledTimes(2);
    expect(scrollChildIntoView).toHaveBeenLastCalledWith("row-12");

    scrollChildIntoView.mockRestore();

    await act(async () => {
      await setup.dispose();
    });
  });
});
