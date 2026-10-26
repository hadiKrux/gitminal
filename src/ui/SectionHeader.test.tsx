import { describe, expect, it } from "bun:test";
import { MouseEvent } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { ShellTestProviders } from "@/test/shell.harness";
import { ICONS } from "@/theme/icons";
import { SectionHeader } from "@/ui/SectionHeader";

async function renderHeader(node: ReactNode): Promise<Awaited<ReturnType<typeof testRender>>> {
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

  return setup;
}

function click(setup: Awaited<ReturnType<typeof testRender>>, id: string): void {
  const box = setup.renderer.root.findDescendantById(id);

  if (box === undefined) {
    throw new Error(`section header ${id} is missing`);
  }

  box.processMouseEvent(
    new MouseEvent(box, {
      type: "down",
      button: 0,
      x: 0,
      y: 0,
      modifiers: { shift: false, alt: false, ctrl: false },
    }),
  );
}

describe("SectionHeader", () => {
  it("renders the expanded marker with its title", async () => {
    const setup = await renderHeader(<SectionHeader title="Keybindings" expanded />);

    expect(setup.captureCharFrame()).toContain(`${ICONS.expanded} Keybindings`);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("renders the collapsed marker with its title", async () => {
    const setup = await renderHeader(<SectionHeader title="Keybindings" expanded={false} />);

    expect(setup.captureCharFrame()).toContain(`${ICONS.collapsed} Keybindings`);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("reports a click through the supplied mouse handler", async () => {
    let toggles = 0;
    const setup = await renderHeader(
      <SectionHeader
        id="help::keybindings"
        title="Keybindings"
        expanded
        onMouseDown={() => {
          toggles += 1;
        }}
      />,
    );

    await act(async () => {
      click(setup, "help::keybindings");
    });

    expect(toggles).toBe(1);

    await act(async () => {
      await setup.dispose();
    });
  });
});
