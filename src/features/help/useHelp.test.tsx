import { beforeEach, describe, expect, it, mock } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { resetInputModes } from "@/app/hooks/inputMode.registry";
import { resetActionRegistry, resolveActionHandler } from "@/app/hooks/useAction";
import { useFocusRegion } from "@/app/hooks/useFocusRegion";
import { useHelpAction } from "@/app/hooks/useHelpAction";
import { resolveHotkeyAction } from "@/app/hooks/useHotkeys";
import { resetInputEscapeClear } from "@/app/hooks/useInputEscapeClear";
import { useKeymap } from "@/app/hooks/useKeymap";
import { useOverlay } from "@/app/hooks/useOverlay";
import { useRepository } from "@/app/hooks/useRepository";
import type { KeyEventLike, ResolvedKeymap } from "@/domain/keymap/keymap.types";
import { HELP_OVERLAY_ID } from "@/features/help/HelpModal.constants";
import { useHelp } from "@/features/help/useHelp";
import { HELP_PAGE_ROWS } from "@/features/help/useHelp.constants";
import type { HelpHandle, HelpRowView } from "@/features/help/useHelp.types";
import { AppTestProviders, TestOverlayHost } from "@/test/app.harness";
import { createFakeGitClient } from "@/test/git.fake";

/** Latest help handle captured by the probe. */
let latestHelp: HelpHandle | undefined;

/** Latest repository context captured by the probe. */
let latestRepository: ReturnType<typeof useRepository> | undefined;

/** Latest overlay context captured by the toggle harness. */
let latestOverlay: ReturnType<typeof useOverlay> | undefined;

/** Latest resolved keymap captured by the toggle harness. */
let latestKeymap: ResolvedKeymap | undefined;

/**
 * Mounts the help hook with the region frames its section order reads.
 *
 * @param props - Close callback.
 * @returns The probe content.
 */
function HelpProbe(props: { readonly onClose: () => void }): ReactNode {
  const repository = useRepository();
  const branches = useFocusRegion("branches");
  const rightPane = useFocusRegion("right-pane");

  latestRepository = repository;
  latestHelp = useHelp({ onClose: props.onClose });

  return (
    <box flexDirection="column" width={100} height={30}>
      <box {...branches.regionProps} height={1}>
        <text>branches</text>
      </box>
      <box {...rightPane.regionProps} height={1}>
        <text>right pane</text>
      </box>
      <text>{repository.snapshot === null ? "loading" : "ready"}</text>
    </box>
  );
}

/**
 * Mounts the help action, the overlay host, and the overlay probe.
 *
 * @returns The toggle harness content.
 */
function HelpActionHarness(): ReactNode {
  latestOverlay = useOverlay();
  latestKeymap = useKeymap();
  useHelpAction();

  return <TestOverlayHost />;
}

/**
 * Renders until a predicate holds or the deadline passes.
 *
 * @param setup - Renderer setup.
 * @param predicate - Condition to wait for.
 */
async function waitFor(
  setup: Awaited<ReturnType<typeof testRender>>,
  predicate: () => boolean,
): Promise<void> {
  const deadline = Date.now() + 3_000;

  while (!predicate() && Date.now() < deadline) {
    await act(async () => {
      await setup.renderOnce();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

/**
 * Renders the help hook and waits for the first repository read.
 *
 * @returns The renderer setup and the close mock.
 */
async function renderHelp(): Promise<{
  readonly setup: Awaited<ReturnType<typeof testRender>>;
  readonly onClose: () => void;
}> {
  const onClose = mock(() => {});

  latestHelp = undefined;
  latestRepository = undefined;

  const setup = await testRender(
    <AppTestProviders gitClient={createFakeGitClient().client}>
      <HelpProbe onClose={onClose} />
    </AppTestProviders>,
    { width: 100, height: 30 },
  );

  await waitFor(
    setup,
    () => latestRepository?.snapshot !== null && latestHelp !== undefined && readRows().length > 0,
  );

  return { setup, onClose };
}

/**
 * Reads every currently visible help row.
 *
 * @returns The visible rows in render order.
 */
function readRows(): readonly HelpRowView[] {
  return (latestHelp?.sections ?? []).flatMap((section) => section.rows);
}

/**
 * Finds one visible help row.
 *
 * @param actionId - Action to look up.
 * @returns The row, or undefined when it is not visible.
 */
function findRow(actionId: string): HelpRowView | undefined {
  return readRows().find((row) => row.actionId === actionId);
}

/**
 * Runs one query change and flushes the render.
 *
 * @param setup - Renderer setup.
 * @param query - New query.
 */
async function setQuery(
  setup: Awaited<ReturnType<typeof testRender>>,
  query: string,
): Promise<void> {
  await act(async () => {
    latestHelp?.setQuery(query);
    await setup.renderOnce();
  });
}

/**
 * Waits until the debounced query surfaces the rows a test expects.
 *
 * @param setup - Renderer setup.
 * @param predicate - Condition over the currently visible rows.
 */
async function waitForRows(
  setup: Awaited<ReturnType<typeof testRender>>,
  predicate: (rows: readonly HelpRowView[]) => boolean,
): Promise<void> {
  await waitFor(setup, () => predicate(readRows()));
}

/**
 * Focuses one region frame and flushes the render.
 *
 * @param setup - Renderer setup.
 * @param frameId - Renderable id of the region frame.
 */
async function focusFrame(
  setup: Awaited<ReturnType<typeof testRender>>,
  frameId: string,
): Promise<void> {
  await act(async () => {
    setup.renderer.root.findDescendantById(frameId)?.focus();
    await setup.renderOnce();
  });
}

/**
 * Builds a physical key event for dispatcher assertions.
 *
 * @param name - Base key name.
 * @returns The key event.
 */
function keyEvent(name: string): KeyEventLike {
  return { name, ctrl: false, meta: false, shift: false, option: false, sequence: name };
}

beforeEach(() => {
  resetActionRegistry();
  resetInputModes();
  resetInputEscapeClear();
  latestHelp = undefined;
  latestRepository = undefined;
  latestOverlay = undefined;
  latestKeymap = undefined;
});

describe("useHelp search", () => {
  it("matches the action name case-insensitively", async () => {
    const { setup } = await renderHelp();

    await setQuery(setup, "POP STASH");
    await waitForRows(setup, (rows) => rows.length === 1 && rows[0]?.actionId === "stash.pop");

    expect(findRow("stash.pop")?.label).toBe("Pop stash");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("matches the effective keys, description, and action id", async () => {
    const { setup } = await renderHelp();

    await setQuery(setup, "f1");
    await waitForRows(setup, (rows) => rows.length === 1 && rows[0]?.actionId === "app.help");

    await setQuery(setup, "effective keybinding");
    await waitForRows(setup, (rows) => rows.length === 1 && rows[0]?.actionId === "app.help");

    await setQuery(setup, "focus.region.topbar");
    await waitForRows(
      setup,
      (rows) => rows.length === 1 && rows[0]?.actionId === "focus.region.topBar",
    );

    await act(async () => {
      await setup.dispose();
    });
  });

  it("matches the availability reason", async () => {
    const { setup } = await renderHelp();

    await setQuery(setup, "SELECT AN ITEM FIRST");
    await waitForRows(
      setup,
      (rows) =>
        rows.some((row) => row.actionId === "branch.delete") &&
        !rows.some((row) => row.actionId === "app.help"),
    );

    expect(findRow("branch.delete")?.unavailableReason).toBe("Select an item first");

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("useHelp sections", () => {
  it("keeps every focus.region action and marks the unbound one", async () => {
    const { setup } = await renderHelp();
    const focusSection = latestHelp?.sections.find((section) => section.id === "focus");
    const regionRows = (focusSection?.rows ?? []).filter((row) =>
      row.actionId.startsWith("focus.region."),
    );

    expect(regionRows).toHaveLength(10);
    expect(findRow("focus.region.topBar")?.keys).toEqual([]);
    expect(findRow("focus.region.branches")?.keys).toEqual(["1"]);
    expect(findRow("focus.region.console")?.keys).toEqual(["9"]);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("lists unavailable actions with their exact reason instead of filtering them", async () => {
    const { setup } = await renderHelp();

    expect(findRow("branch.delete")).toBeDefined();
    expect(findRow("branch.delete")?.keys).toEqual(["d"]);
    expect(findRow("branch.delete")?.unavailableReason).toBe("Select an item first");
    expect(findRow("focus.region.topBar")?.unavailableReason).toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows the current focus section first", async () => {
    const { setup } = await renderHelp();

    await focusFrame(setup, "region-branches");
    expect(latestHelp?.sections[0]?.id).toBe("sidebar");

    await focusFrame(setup, "region-right-pane");
    expect(latestHelp?.sections[0]?.id).toBe("composer");

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("useHelp composer availability", () => {
  it("reports the shared composer reason for a commit selection and clears it for pending", async () => {
    const { setup } = await renderHelp();

    await act(async () => {
      latestRepository?.setSelection({ kind: "commit", oid: "abc123" });
      await setup.renderOnce();
    });

    expect(findRow("commit.focus")?.unavailableReason).toBe("The commit composer is not visible");

    await act(async () => {
      latestRepository?.setSelection({ kind: "pending" });
      await setup.renderOnce();
    });

    expect(findRow("commit.focus")?.unavailableReason).toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("useHelp cursor bounds", () => {
  it("moves to the first and last visible row", async () => {
    const { setup } = await renderHelp();
    const rows = readRows();

    await act(async () => {
      resolveActionHandler("nav.last", "overlay")?.();
      await setup.renderOnce();
    });

    expect(latestHelp?.selectedActionId).toBe(rows.at(-1)?.actionId);

    await act(async () => {
      resolveActionHandler("nav.first", "overlay")?.();
      await setup.renderOnce();
    });

    expect(latestHelp?.selectedActionId).toBe(rows[0]?.actionId);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("collapses the section under the cursor and keeps a valid visible row", async () => {
    const { setup } = await renderHelp();

    await act(async () => {
      resolveActionHandler("nav.first", "overlay")?.();
      resolveActionHandler("nav.down", "overlay")?.();
      await setup.renderOnce();
    });

    const selected = latestHelp?.selectedActionId;
    const target = latestHelp?.sections.find((section) =>
      section.rows.some((row) => row.actionId === selected),
    );

    expect(selected).not.toBeNull();
    expect(target?.rows.length).toBeGreaterThan(1);

    await act(async () => {
      resolveActionHandler("nav.left", "overlay")?.();
      await setup.renderOnce();
    });

    const collapsed = latestHelp?.sections.find((section) => section.id === target?.id);
    const visible = (latestHelp?.sections ?? [])
      .filter((section) => !section.collapsed)
      .flatMap((section) => section.rows);

    expect(collapsed?.collapsed).toBeTrue();
    expect(collapsed?.title).toBe(target?.title);
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.some((row) => row.actionId === latestHelp?.selectedActionId)).toBeTrue();
    expect(visible.some((row) => row.actionId === selected)).toBeFalse();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the filtered match count while every section is collapsed", async () => {
    const { setup } = await renderHelp();
    const before = latestHelp?.matchCount;
    const sectionIds = (latestHelp?.sections ?? []).map((section) => section.id);

    await act(async () => {
      for (const sectionId of sectionIds) {
        latestHelp?.toggleSection(sectionId);
      }

      await setup.renderOnce();
    });

    expect(before).toBeGreaterThan(0);
    expect(latestHelp?.sections.every((section) => section.collapsed)).toBeTrue();
    expect(latestHelp?.matchCount).toBe(before);

    await act(async () => {
      resolveActionHandler("nav.right", "overlay")?.();
      await setup.renderOnce();
    });

    expect(latestHelp?.sections.some((section) => !section.collapsed)).toBeTrue();
    expect(latestHelp?.selectedActionId).not.toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("useHelp paging bounds", () => {
  it("moves by the documented page step and clamps at the last row", async () => {
    const { setup } = await renderHelp();
    const rows = readRows();

    await act(async () => {
      resolveActionHandler("nav.pageDown", "overlay")?.();
      await setup.renderOnce();
    });

    expect(latestHelp?.selectedActionId).toBe(rows[HELP_PAGE_ROWS]?.actionId);

    for (let press = 0; press < 40; press += 1) {
      await act(async () => {
        resolveActionHandler("nav.pageDown", "overlay")?.();
      });
    }

    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestHelp?.selectedActionId).toBe(rows.at(-1)?.actionId);

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("useHelp Esc handling", () => {
  it("clears the search and then closes on the second press", async () => {
    const { setup, onClose } = await renderHelp();

    await setQuery(setup, "stash");

    await act(async () => {
      resolveActionHandler("overlay.close", "overlay")?.();
      await setup.renderOnce();
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(latestHelp?.query).toBe("");

    await act(async () => {
      resolveActionHandler("overlay.close", "overlay")?.();
      await setup.renderOnce();
    });

    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("app.help toggle", () => {
  it("opens help and closes it on the second call", async () => {
    const setup = await testRender(
      <AppTestProviders gitClient={createFakeGitClient().client}>
        <HelpActionHarness />
      </AppTestProviders>,
      { width: 100, height: 30 },
    );

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      resolveActionHandler("app.help", "global")?.();
      await setup.renderOnce();
    });

    expect(latestOverlay?.entry?.id).toBe(HELP_OVERLAY_ID);

    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).toContain("Focus branches");

    await act(async () => {
      resolveActionHandler("app.help", "global")?.();
      await setup.renderOnce();
    });

    expect(latestOverlay?.entry).toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("resolves the F1 alternative to the same toggle and closes help", async () => {
    const setup = await testRender(
      <AppTestProviders gitClient={createFakeGitClient().client}>
        <HelpActionHarness />
      </AppTestProviders>,
      { width: 100, height: 30 },
    );

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      resolveActionHandler("app.help", "global")?.();
      await setup.renderOnce();
    });

    expect(latestOverlay?.entry?.id).toBe(HELP_OVERLAY_ID);
    expect(latestKeymap).toBeDefined();

    const resolution = resolveHotkeyAction({
      keymap: latestKeymap as ResolvedKeymap,
      key: keyEvent("f1"),
      activeRegion: null,
      textInputFocused: false,
      nativeListFocused: false,
      overlayOpen: true,
      overlayToggleActionId: "app.help",
    });

    expect(resolution).toEqual({ actionId: "app.help", scope: "global" });

    await act(async () => {
      resolveActionHandler("app.help", "global")?.();
      await setup.renderOnce();
    });

    expect(latestOverlay?.entry).toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });
});
