import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { HelpRow } from "@/features/help/HelpRow";
import { HELP_UNBOUND_LABEL } from "@/features/help/HelpRow.constants";
import type { HelpRowView } from "@/features/help/useHelp.types";
import { ShellTestProviders } from "@/test/shell.harness";

/** Width the row is rendered at, wide enough that the detail text is not truncated. */
const ROW_WIDTH = 120;

/**
 * Renders one help row inside a bounded column.
 *
 * @param props - Row to render.
 * @returns The row harness.
 */
function RowHarness(props: { readonly row: HelpRowView }): ReactNode {
  return (
    <box flexDirection="column" width={ROW_WIDTH} height={4}>
      <HelpRow row={props.row} width={ROW_WIDTH} selected={false} onSelect={() => {}} />
    </box>
  );
}

/**
 * Builds a help row with the defaults these tests do not override.
 *
 * @param overrides - Fields the test cares about.
 * @returns The row to render.
 */
function buildRow(overrides: Partial<HelpRowView> = {}): HelpRowView {
  return {
    actionId: "stash.pop",
    label: "Pop stash",
    description: "Apply and remove the selected stash after confirmation.",
    keys: ["Alt+P"],
    sectionId: "sidebar",
    unavailableReason: null,
    ...overrides,
  };
}

/**
 * Renders one row and returns the captured frame text.
 *
 * @param row - Row to render.
 * @returns The captured frame.
 */
async function renderRow(row: HelpRowView): Promise<string> {
  const setup = await testRender(
    <ShellTestProviders>
      <RowHarness row={row} />
    </ShellTestProviders>,
    { width: ROW_WIDTH, height: 6 },
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

describe("HelpRow", () => {
  it("renders the effective keys after a configuration override", async () => {
    const frame = await renderRow(buildRow({ keys: ["Ctrl+P"] }));

    expect(frame).toContain("Pop stash");
    expect(frame).toContain("Ctrl+P");
    expect(frame).toContain("Apply and remove the selected stash");
  });

  it("renders Unbound for an action with no binding", async () => {
    const frame = await renderRow(buildRow({ keys: [] }));

    expect(frame).toContain(HELP_UNBOUND_LABEL);
    expect(frame).toContain("Pop stash");
  });

  it("renders the exact availability reason while keeping the keys", async () => {
    const frame = await renderRow(
      buildRow({ keys: ["Alt+P"], unavailableReason: "no stash selected" }),
    );

    expect(frame).toContain("no stash selected");
    expect(frame).toContain("Alt+P");
    expect(frame).toContain("Apply and remove");
  });
});
