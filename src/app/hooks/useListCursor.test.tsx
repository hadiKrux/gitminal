import { beforeEach, describe, expect, it, setSystemTime } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode, useState } from "react";
import {
  hasRegisteredAction,
  resetActionRegistry,
  resolveActionHandler,
} from "@/app/hooks/useAction";
import { useFocusRegion } from "@/app/hooks/useFocusRegion";
import { useFocusState } from "@/app/hooks/useFocusState";
import { useListCursor } from "@/app/hooks/useListCursor";
import type { ListCursorHandle } from "@/app/hooks/useListCursor.types";
import { ShellTestProviders } from "@/test/shell.harness";

const DEFAULT_ITEMS = [{ id: "main" }, { id: "develop" }, { id: "feature" }] as const;

let handle: ListCursorHandle | undefined;
let readRegionCursor: () => string | null = () => null;
let activations = 0;
let doubleClickIndexes: number[] = [];
let setItems: (items: readonly { readonly id: string }[]) => void = () => {};
let setVisible: (visible: boolean) => void = () => {};
let setDelegateResult: (handled: boolean) => void = () => {};
const delegateCalls: string[] = [];

function CursorPanel(props: {
  items: readonly { readonly id: string }[];
  enableFirstLast?: boolean;
}): ReactNode {
  const region = useFocusRegion("branches");

  handle = useListCursor({
    regionId: "branches",
    items: props.items,
    enableFirstLast: props.enableFirstLast,
    onActivate: () => {
      activations += 1;
    },
    onDoubleClick: (index) => {
      doubleClickIndexes.push(index);
    },
  });

  return (
    <box {...region.regionProps} flexDirection="column" width={30} height={5}>
      <box id="outside" focusable width={10} height={1}>
        <text>outside</text>
      </box>
      <text>{handle.activeId ?? "none"}</text>
    </box>
  );
}

function DelegatingPanel(): ReactNode {
  const region = useFocusRegion("branches");
  const [handled, setHandled] = useState(true);

  setDelegateResult = setHandled;

  handle = useListCursor({
    regionId: "branches",
    items: DEFAULT_ITEMS,
    onActivate: () => {
      activations += 1;
    },
    delegateAction: (action) => {
      delegateCalls.push(action);

      return handled;
    },
  });

  return (
    <box {...region.regionProps} flexDirection="column" width={30} height={5}>
      <text>{handle.activeId ?? "none"}</text>
    </box>
  );
}

function Harness(props: {
  enableFirstLast?: boolean;
  initialItems?: readonly { id: string }[];
}): ReactNode {
  const [items, setPanelItems] = useState<readonly { readonly id: string }[]>(
    props.initialItems ?? DEFAULT_ITEMS,
  );
  const [visible, setPanelVisible] = useState(true);
  const focus = useFocusState();

  setItems = setPanelItems;
  setVisible = setPanelVisible;
  readRegionCursor = () => focus.getCursor("branches");

  if (!visible) {
    return (
      <box width={30} height={1}>
        <text>hidden</text>
      </box>
    );
  }

  return <CursorPanel items={items} enableFirstLast={props.enableFirstLast} />;
}

async function renderHarness(
  node: ReactNode = <Harness />,
): Promise<Awaited<ReturnType<typeof testRender>>> {
  const setup = await testRender(<ShellTestProviders>{node}</ShellTestProviders>, {
    width: 30,
    height: 6,
  });

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

async function runAction(actionId: string): Promise<void> {
  await act(async () => {
    resolveActionHandler(actionId, "branches")?.();
  });
}

async function focusOutside(setup: Awaited<ReturnType<typeof testRender>>): Promise<void> {
  await act(async () => {
    setup.renderer.root.findDescendantById("outside")?.focus();
  });
  await act(async () => {
    await setup.renderOnce();
  });
}

beforeEach(() => {
  resetActionRegistry();
  handle = undefined;
  activations = 0;
  doubleClickIndexes = [];
  setItems = () => {};
  setVisible = () => {};
  setDelegateResult = () => {};
  delegateCalls.length = 0;
});

describe("useListCursor registration", () => {
  it("registers the navigation actions in the region scope only", async () => {
    const setup = await renderHarness();

    for (const actionId of ["nav.up", "nav.down", "nav.activate", "nav.first", "nav.last"]) {
      expect(hasRegisteredAction(actionId, "branches")).toBe(true);
      expect(hasRegisteredAction(actionId, "global")).toBe(false);
    }

    expect(hasRegisteredAction("app.refresh", "global")).toBe(false);
    expect(hasRegisteredAction("focus.next", "global")).toBe(false);
    expect(hasRegisteredAction("focus.region.branches", "branches")).toBe(false);
    expect(hasRegisteredAction("nav.up", "tags")).toBe(false);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("omits nav.first and nav.last when enableFirstLast is false", async () => {
    const setup = await renderHarness(
      <Harness enableFirstLast={false} initialItems={DEFAULT_ITEMS} />,
    );

    expect(hasRegisteredAction("nav.up", "branches")).toBe(true);
    expect(hasRegisteredAction("nav.down", "branches")).toBe(true);
    expect(hasRegisteredAction("nav.activate", "branches")).toBe(true);
    expect(hasRegisteredAction("nav.first", "branches")).toBe(false);
    expect(hasRegisteredAction("nav.last", "branches")).toBe(false);

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("useListCursor navigation", () => {
  it("starts on the first row and persists the cursor by item id", async () => {
    const setup = await renderHarness();

    expect(handle?.index).toBe(0);
    expect(handle?.activeId).toBe("main");
    expect(readRegionCursor()).toBe("main");

    await runAction("nav.down");

    expect(handle?.index).toBe(1);
    expect(handle?.activeId).toBe("develop");
    expect(readRegionCursor()).toBe("develop");

    await runAction("nav.last");

    expect(handle?.activeId).toBe("feature");
    expect(readRegionCursor()).toBe("feature");

    await runAction("nav.first");

    expect(handle?.activeId).toBe("main");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the active item when the list is reordered", async () => {
    const setup = await renderHarness();

    await runAction("nav.down");
    expect(handle?.activeId).toBe("develop");

    await act(async () => {
      setItems([{ id: "develop" }, { id: "main" }, { id: "feature" }]);
    });

    expect(handle?.index).toBe(0);
    expect(handle?.activeId).toBe("develop");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("selects a row by id and writes it to the region cursor", async () => {
    const setup = await renderHarness();

    await act(async () => {
      handle?.selectId("feature");
    });

    expect(handle?.index).toBe(2);
    expect(handle?.activeId).toBe("feature");
    expect(readRegionCursor()).toBe("feature");

    await act(async () => {
      handle?.selectId("missing");
    });

    expect(handle?.activeId).toBe("feature");
    expect(readRegionCursor()).toBe("feature");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("restores the persisted cursor by id after the panel remounts", async () => {
    const setup = await renderHarness();

    await runAction("nav.down");
    await runAction("nav.down");
    expect(handle?.activeId).toBe("feature");
    expect(readRegionCursor()).toBe("feature");

    await act(async () => {
      setVisible(false);
    });
    await act(async () => {
      setVisible(true);
    });

    expect(handle?.activeId).toBe("feature");
    expect(handle?.index).toBe(2);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("clamps the cursor when the list shrinks", async () => {
    const setup = await renderHarness();

    await runAction("nav.last");
    expect(handle?.activeId).toBe("feature");

    await act(async () => {
      setItems([{ id: "main" }]);
    });

    expect(handle?.index).toBe(0);
    expect(handle?.activeId).toBe("main");
    expect(readRegionCursor()).toBe("main");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("handles an empty list without activating or throwing", async () => {
    const setup = await renderHarness();
    await act(async () => {
      setItems([]);
    });

    expect(handle?.index).toBe(0);
    expect(handle?.activeId).toBeNull();

    await runAction("nav.activate");
    await runAction("nav.up");
    await runAction("nav.down");
    await runAction("nav.first");
    await runAction("nav.last");

    expect(activations).toBe(0);
    expect(handle?.index).toBe(0);

    await act(async () => {
      setItems(DEFAULT_ITEMS);
    });
    await runAction("nav.activate");

    expect(activations).toBe(1);

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("useListCursor delegation", () => {
  it("lets a delegate handle actions before the cursor moves or activates", async () => {
    const setup = await renderHarness(<DelegatingPanel />);

    await runAction("nav.down");
    await runAction("nav.first");
    await runAction("nav.activate");

    expect(delegateCalls).toEqual(["down", "first", "activate"]);
    expect(handle?.activeId).toBe("main");
    expect(activations).toBe(0);

    await act(async () => {
      setDelegateResult(false);
    });
    await runAction("nav.down");

    expect(delegateCalls).toEqual(["down", "first", "activate", "down"]);
    expect(handle?.activeId).toBe("develop");

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("useListCursor clicking", () => {
  it("selects a clicked row and dispatches one double click inside the threshold", async () => {
    const setup = await renderHarness();
    await focusOutside(setup);

    setSystemTime(1_000);
    await act(async () => {
      handle?.handleRowClick(1);
    });

    expect(handle?.activeId).toBe("develop");
    expect(doubleClickIndexes).toEqual([]);

    setSystemTime(1_100);
    await act(async () => {
      handle?.handleRowClick(1);
    });

    expect(doubleClickIndexes).toEqual([1]);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("outside");

    await act(async () => {
      handle?.handleRowClick(1);
    });

    expect(doubleClickIndexes).toEqual([1]);

    setSystemTime();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("reports the clicked row when both clicks land before a render", async () => {
    const setup = await renderHarness();

    setSystemTime(4_000);
    await act(async () => {
      handle?.handleRowClick(2);
      handle?.handleRowClick(2);
    });

    expect(doubleClickIndexes).toEqual([2]);
    expect(handle?.activeId).toBe("feature");

    setSystemTime();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("does not treat slow clicks or different rows as a double click", async () => {
    const setup = await renderHarness();

    setSystemTime(2_000);
    await act(async () => {
      handle?.handleRowClick(0);
    });
    setSystemTime(2_500);
    await act(async () => {
      handle?.handleRowClick(0);
    });

    expect(doubleClickIndexes).toEqual([]);

    setSystemTime(3_000);
    await act(async () => {
      handle?.handleRowClick(0);
    });
    setSystemTime(3_050);
    await act(async () => {
      handle?.handleRowClick(2);
    });

    expect(doubleClickIndexes).toEqual([]);
    expect(handle?.activeId).toBe("feature");

    setSystemTime();

    await act(async () => {
      await setup.dispose();
    });
  });
});
