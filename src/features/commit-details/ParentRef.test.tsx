import { beforeEach, describe, expect, it } from "bun:test";
import { MouseEvent } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { resetActionRegistry } from "@/app/hooks/useAction";
import { useListCursor } from "@/app/hooks/useListCursor";
import { ParentRef } from "@/features/commit-details/ParentRef";
import { ShellTestProviders } from "@/test/shell.harness";

/**
 * Simulates one left mouse click on a renderable.
 *
 * @param setup - Renderer setup.
 * @param id - Renderable id of the row.
 */
function clickRow(setup: Awaited<ReturnType<typeof testRender>>, id: string): void {
  const row = setup.renderer.root.findDescendantById(id);

  if (row === undefined) {
    throw new Error(`row ${id} is missing`);
  }

  row.processMouseEvent(
    new MouseEvent(row, {
      type: "down",
      button: 0,
      x: 1,
      y: 0,
      modifiers: { shift: false, alt: false, ctrl: false },
    }),
  );
}

/**
 * Renders a parent row wired to the shared cursor.
 *
 * The host mirrors the feature wiring: the cursor owns selection and double-click detection, and the
 * row only reports mouse downs.
 *
 * @param props - Parent identity and activation callback.
 * @returns The row host.
 */
function ParentRowHost(props: {
  readonly oid: string;
  readonly onActivate: () => void;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
}): ReactNode {
  const cursor = useListCursor({
    regionId: "right-pane",
    items: [{ id: props.oid }],
    onActivate: props.onActivate,
    onDoubleClick: props.onActivate,
    enableFirstLast: false,
  });

  return (
    <box flexDirection="column" width={60} height={3}>
      <ParentRef
        oid={props.oid}
        shortOid="abc1234"
        subject="feat: parent subject"
        selected={cursor.index === 0}
        focused
        disabled={props.disabled}
        disabledReason={props.disabledReason}
        onMouseDown={() => {
          cursor.handleRowClick(0);
        }}
      />
    </box>
  );
}

/**
 * Renders one parent row host.
 *
 * @param props - Parent identity, activation callback, and disabled state.
 * @returns The renderer setup.
 */
async function renderParent(props: {
  readonly oid: string;
  readonly onActivate: () => void;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
}): Promise<Awaited<ReturnType<typeof testRender>>> {
  const setup = await testRender(
    <ShellTestProviders>
      <ParentRowHost {...props} />
    </ShellTestProviders>,
    { width: 60, height: 5 },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

beforeEach(() => {
  resetActionRegistry();
});

describe("ParentRef", () => {
  it("renders the short hash and the parent subject", async () => {
    const setup = await renderParent({ oid: "abcdef123456", onActivate: () => {} });
    const frame = setup.captureCharFrame();

    expect(frame).toContain("abc1234");
    expect(frame).toContain("feat: parent subject");
    expect(setup.renderer.root.findDescendantById("commit-parent-abcdef123456")).toBeDefined();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("dispatches the same activation as nav.activate on a double click", async () => {
    let activations = 0;
    const setup = await renderParent({
      oid: "abcdef123456",
      onActivate: () => {
        activations += 1;
      },
    });

    await act(async () => {
      clickRow(setup, "commit-parent-abcdef123456");
      clickRow(setup, "commit-parent-abcdef123456");
    });

    expect(activations).toBe(1);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the row visible with its disabled reason while the parent loads", async () => {
    const setup = await renderParent({
      oid: "abcdef123456",
      onActivate: () => {},
      disabled: true,
      disabledReason: "Loading parent commit...",
    });
    const frame = setup.captureCharFrame();

    expect(frame).toContain("abc1234");
    expect(frame).toContain("Loading parent commit...");

    await act(async () => {
      await setup.dispose();
    });
  });
});
