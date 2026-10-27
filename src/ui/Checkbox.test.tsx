import { describe, expect, it } from "bun:test";
import { type CapturedFrame, type CapturedSpan, MouseEvent, RGBA } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { ShellTestProviders } from "@/test/shell.harness";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import { Checkbox } from "@/ui/Checkbox";

let capturedTokens: ReturnType<typeof useTokens> | undefined;

/** Cell of the checkbox label that the renderer-level click tests press. */
const CHECKBOX_CLICK_X = 2;

/** Row of the checkbox label that the renderer-level click tests press. */
const CHECKBOX_CLICK_Y = 0;

function TokenProbe(): null {
  capturedTokens = useTokens();

  return null;
}

function readTokens(): ReturnType<typeof useTokens> {
  if (capturedTokens === undefined) {
    throw new Error("theme tokens were not captured");
  }

  return capturedTokens;
}

async function renderCheckbox(node: ReactNode): Promise<Awaited<ReturnType<typeof testRender>>> {
  const setup = await testRender(
    <ShellTestProviders>
      <TokenProbe />
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

function findSpanContaining(frame: CapturedFrame, text: string): CapturedSpan {
  for (const line of frame.lines) {
    for (const span of line.spans) {
      if (span.text.includes(text)) {
        return span;
      }
    }
  }

  throw new Error(`No captured span contains ${text}`);
}

function click(setup: Awaited<ReturnType<typeof testRender>>, id: string): void {
  const box = setup.renderer.root.findDescendantById(id);

  if (box === undefined) {
    throw new Error(`checkbox ${id} is missing`);
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

describe("Checkbox", () => {
  it("renders the checked marker from ICONS", async () => {
    const setup = await renderCheckbox(
      <Checkbox id="checkout" label="Check out after creating" checked onPress={() => {}} />,
    );

    expect(setup.captureCharFrame()).toContain(`${ICONS.checkboxOn} Check out after creating`);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("renders the unchecked marker from ICONS", async () => {
    const setup = await renderCheckbox(
      <Checkbox id="include" label="Include untracked files" checked={false} onPress={() => {}} />,
    );

    expect(setup.captureCharFrame()).toContain(`${ICONS.checkboxOff} Include untracked files`);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("colors a focused marker with the focus token and activates on click", async () => {
    let presses = 0;
    const setup = await renderCheckbox(
      <Checkbox
        id="force"
        label="Force remove"
        checked
        focused
        onPress={() => {
          presses += 1;
        }}
      />,
    );
    const marker = findSpanContaining(setup.captureSpans(), ICONS.checkboxOn);
    const tokens = readTokens();

    expect(marker.fg.equals(RGBA.fromHex(tokens.focus))).toBe(true);

    await act(async () => {
      click(setup, "force");
    });

    expect(presses).toBe(1);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("activates on a renderer click without leaving the label text-selected", async () => {
    let presses = 0;
    const setup = await renderCheckbox(
      <Checkbox
        label="Force remove"
        checked
        onPress={() => {
          presses += 1;
        }}
      />,
    );

    await act(async () => {
      await setup.mockMouse.click(CHECKBOX_CLICK_X, CHECKBOX_CLICK_Y);
    });

    expect(presses).toBe(1);
    expect(setup.renderer.hasSelection).toBe(false);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("ignores clicks while disabled and renders the dim text token", async () => {
    let presses = 0;
    const setup = await renderCheckbox(
      <Checkbox
        id="force"
        label="Force remove"
        checked={false}
        disabled
        onPress={() => {
          presses += 1;
        }}
      />,
    );
    const label = findSpanContaining(setup.captureSpans(), "Force remove");
    const tokens = readTokens();

    expect(label.fg.equals(RGBA.fromHex(tokens.dim))).toBe(true);

    await act(async () => {
      click(setup, "force");
    });

    expect(presses).toBe(0);

    await act(async () => {
      await setup.dispose();
    });
  });
});
