import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { Renderable, ScrollBoxRenderable } from "@opentui/core";
import { ScrollBoxRenderable as ScrollBoxRenderableClass } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode, useMemo, useState } from "react";
import { useScrollSelectedRow } from "@/app/hooks/useScrollSelectedRow";
import type { ScrollChildIntoViewTarget } from "@/app/hooks/useScrollSelectedRow.types";
import type { SidebarPanel } from "@/features/shell/focus.types";
import { SidebarPanelFrame } from "@/features/shell/SidebarPanelFrame";
import { ShellTestProviders } from "@/test/shell.harness";

const ROW_COUNT = 30;
const ROW_IDS = Array.from({ length: ROW_COUNT }, (_, index) => `row-${index}`);
const TARGETED_ROW_IDS = Array.from({ length: ROW_COUNT }, (_, index) => `targeted-row-${index}`);

let setActiveId: (id: string | null) => void = () => {};
let forceRender: () => void = () => {};
let insertRowAbove: () => void = () => {};
let revealCalls: string[] = [];
let setTargetedActiveId: (id: string | null) => void = () => {};
let forceTargetedRender: () => void = () => {};
let bumpTargetedRevision: () => void = () => {};
let setTargetEnabled: (enabled: boolean) => void = () => {};

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

/**
 * Renders rows that reveal their active row through a caller-owned scroll target.
 *
 * No `PanelScrollProvider` is mounted around this list, so the explicit target is the only reveal
 * path the hook can use.
 *
 * @param props - Active row id, position revision, and the optional explicit target.
 * @returns The row list body.
 */
function TargetedRowList(props: {
  readonly activeId: string | null;
  readonly revision: number;
  readonly target?: ScrollChildIntoViewTarget;
}): ReactNode {
  useScrollSelectedRow(props.activeId, props.revision, props.target);

  return (
    <box flexDirection="column" flexShrink={0}>
      {TARGETED_ROW_IDS.map((rowId) => (
        <box id={rowId} key={rowId} height={1} flexShrink={0}>
          <text>{rowId}</text>
        </box>
      ))}
    </box>
  );
}

/**
 * Hosts the explicit-target list and exposes the harness controls the tests drive.
 *
 * @returns The targeted row list with its recording scroll target.
 */
function ExplicitTargetHarness(): ReactNode {
  const [activeId, setActive] = useState<string | null>("targeted-row-0");
  const [revision, setRevision] = useState(0);
  const [targetEnabled, setEnabled] = useState(true);
  const [, setTick] = useState(0);
  const target = useMemo<ScrollChildIntoViewTarget>(
    () => ({
      /**
       * Records one reveal request.
       *
       * @param childId - Row the hook asked to reveal.
       */
      scrollChildIntoView: (childId: string): void => {
        revealCalls.push(childId);
      },
    }),
    [],
  );

  setTargetedActiveId = setActive;
  forceTargetedRender = () => setTick((tick) => tick + 1);
  bumpTargetedRevision = () => setRevision((current) => current + 1);
  setTargetEnabled = setEnabled;

  return (
    <box flexDirection="column" width={40} height={10}>
      <TargetedRowList
        activeId={activeId}
        revision={revision}
        target={targetEnabled ? target : undefined}
      />
    </box>
  );
}

/**
 * Renders the explicit-target harness inside the shell providers.
 *
 * @returns The renderer setup with the initial reveal already recorded and cleared.
 */
async function renderExplicitTargetHarness(): Promise<Awaited<ReturnType<typeof testRender>>> {
  const setup = await testRender(
    <ShellTestProviders>
      <ExplicitTargetHarness />
    </ShellTestProviders>,
    {
      width: 40,
      height: 10,
    },
  );

  await act(async () => {
    await setup.renderOnce();
  });
  revealCalls = [];

  return setup;
}

beforeEach(() => {
  setActiveId = () => {};
  forceRender = () => {};
  insertRowAbove = () => {};
  revealCalls = [];
  setTargetedActiveId = () => {};
  forceTargetedRender = () => {};
  bumpTargetedRevision = () => {};
  setTargetEnabled = () => {};
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

describe("useScrollSelectedRow explicit target", () => {
  it("reveals through a caller-owned target without a panel provider", async () => {
    const setup = await renderExplicitTargetHarness();

    expect(revealCalls).toEqual([]);

    await act(async () => {
      setTargetedActiveId("targeted-row-12");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(revealCalls).toEqual(["targeted-row-12"]);

    await act(async () => {
      forceTargetedRender();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(revealCalls).toEqual(["targeted-row-12"]);

    await act(async () => {
      bumpTargetedRevision();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(revealCalls).toEqual(["targeted-row-12", "targeted-row-12"]);

    await act(async () => {
      setTargetedActiveId("targeted-row-3");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(revealCalls).toEqual(["targeted-row-12", "targeted-row-12", "targeted-row-3"]);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("does nothing when no target and no panel provider are available", async () => {
    const setup = await renderExplicitTargetHarness();

    await act(async () => {
      setTargetEnabled(false);
    });
    await act(async () => {
      setTargetedActiveId("targeted-row-7");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(revealCalls).toEqual([]);

    await act(async () => {
      await setup.dispose();
    });
  });
});
