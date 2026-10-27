import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { PendingChangesRow } from "@/features/graph/PendingChangesRow";
import { ShellTestProviders } from "@/test/shell.harness";

/**
 * Renders the Pending Changes row.
 *
 * @param unstagedCount - Count to show.
 * @param selected - Selection flag.
 * @returns The renderer setup.
 */
async function renderPending(
  unstagedCount: number,
  selected: boolean = true,
): Promise<Awaited<ReturnType<typeof testRender>>> {
  const setup = await testRender(
    <ShellTestProviders>
      <box flexDirection="column" width={50} height={4}>
        <PendingChangesRow unstagedCount={unstagedCount} selected={selected} focused={selected} />
      </box>
    </ShellTestProviders>,
    { width: 50, height: 5 },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

describe("PendingChangesRow", () => {
  it("shows the label and the plural unstaged count without a selection marker", async () => {
    const setup = await renderPending(10);
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Commit Changes");
    expect(frame).toContain("10 unstaged files");
    expect(frame).not.toContain(">");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("uses the singular label for one file", async () => {
    const setup = await renderPending(1);

    expect(setup.captureCharFrame()).toContain("1 unstaged file");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows the clean working tree state and remains selectable", async () => {
    const setup = await renderPending(0);
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Working tree clean");
    expect(frame).toContain("Commit Changes");
    expect(frame).not.toContain(">");

    await act(async () => {
      await setup.dispose();
    });
  });
});
