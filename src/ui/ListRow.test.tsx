import { describe, expect, it } from "bun:test";
import { type CapturedFrame, type CapturedSpan, MouseEvent, RGBA } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { ShellTestProviders } from "@/test/shell.harness";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import { ListRow } from "@/ui/ListRow";

let capturedTokens: ReturnType<typeof useTokens> | undefined;

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

async function renderRows(node: ReactNode): Promise<Awaited<ReturnType<typeof testRender>>> {
  const setup = await testRender(
    <ShellTestProviders>
      <TokenProbe />
      <box flexDirection="column" width={40} height={6}>
        {node}
      </box>
    </ShellTestProviders>,
    { width: 40, height: 6 },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

function readFrameText(frame: CapturedFrame): string {
  return frame.lines.map((line) => line.spans.map((span) => span.text).join("")).join("\n");
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

describe("ListRow", () => {
  it("marks the selected row with the selection marker and a dark surface background", async () => {
    const setup = await renderRows(
      <ListRow id="row" selected>
        <text>main</text>
      </ListRow>,
    );
    const frame = setup.captureSpans();
    const selected = findSpanContaining(frame, "main");
    const tokens = readTokens();

    expect(readFrameText(frame)).toContain(ICONS.selected);
    expect(selected.bg.equals(RGBA.fromHex(tokens.surface))).toBe(true);
    expect(selected.bg.equals(RGBA.fromHex(tokens.selection))).toBe(false);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("leaves an unselected row transparent and shows a blank marker", async () => {
    const setup = await renderRows(
      <ListRow id="row">
        <text>develop</text>
      </ListRow>,
    );
    const frame = setup.captureSpans();
    const row = findSpanContaining(frame, "develop");
    const tokens = readTokens();

    expect(readFrameText(frame)).not.toContain(ICONS.selected);
    expect(row.bg.equals(RGBA.fromHex(tokens.selection))).toBe(false);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("can suppress the marker while keeping the selected fill", async () => {
    const setup = await renderRows(
      <ListRow id="row" selected showMarker={false}>
        <text>main</text>
      </ListRow>,
    );
    const frame = setup.captureSpans();
    const selected = findSpanContaining(frame, "main");
    const tokens = readTokens();

    expect(readFrameText(frame)).not.toContain(ICONS.selected);
    expect(selected.bg.equals(RGBA.fromHex(tokens.surface))).toBe(true);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("colors the marker with the focus token while the region is focused", async () => {
    const setup = await renderRows(
      <ListRow id="row" selected focused>
        <text>main</text>
      </ListRow>,
    );
    const frame = setup.captureSpans();
    const marker = findSpanContaining(frame, ICONS.focus);
    const tokens = readTokens();

    expect(marker.fg.equals(RGBA.fromHex(tokens.focus))).toBe(true);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("runs the mouse handler without leaving the row text-selected", async () => {
    let presses = 0;
    const setup = await renderRows(
      <ListRow
        id="row"
        selected
        onMouseDown={() => {
          presses += 1;
        }}
      >
        <text>main</text>
      </ListRow>,
    );

    await act(async () => {
      await setup.mockMouse.click(1, 0);
    });

    expect(presses).toBe(1);
    expect(setup.renderer.hasSelection).toBe(false);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("runs the mouse handler without taking native focus", async () => {
    let presses = 0;
    const setup = await renderRows(
      <box flexDirection="column">
        <box id="outside" focusable width={10} height={1}>
          <text>outside</text>
        </box>
        <ListRow
          id="row"
          selected
          onMouseDown={() => {
            presses += 1;
          }}
        >
          <text>main</text>
        </ListRow>
      </box>,
    );

    await act(async () => {
      setup.renderer.root.findDescendantById("outside")?.focus();
    });

    await act(async () => {
      clickRow(setup, "row");
    });

    expect(presses).toBe(1);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("outside");

    await act(async () => {
      await setup.dispose();
    });
  });
});
