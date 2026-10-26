import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { ShellTestProviders } from "@/test/shell.harness";
import { EmptyState } from "@/ui/EmptyState";

async function renderEmptyState(node: ReactNode): Promise<string> {
  const setup = await testRender(
    <ShellTestProviders>
      <box flexDirection="column" width={40} height={4}>
        {node}
      </box>
    </ShellTestProviders>,
    { width: 40, height: 4 },
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

describe("EmptyState", () => {
  it("renders the message and the action hint", async () => {
    const frame = await renderEmptyState(
      <EmptyState message="No local branches" hint="n New branch" />,
    );

    expect(frame).toContain("No local branches");
    expect(frame).toContain("n New branch");
  });

  it("omits the hint when none is supplied", async () => {
    const frame = await renderEmptyState(<EmptyState message="No stashes" />);

    expect(frame).toContain("No stashes");
    expect(frame).not.toContain("New branch");
  });
});
