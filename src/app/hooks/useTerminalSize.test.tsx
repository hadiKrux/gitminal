import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { useTerminalSize } from "@/app/hooks/useTerminalSize";
import { ShellTestProviders } from "@/test/shell.harness";

/** Chrome reserved by the probe, replaced before each render. */
let chrome: Parameters<typeof useTerminalSize>[0];

/** Value captured by the probe on every render. */
let captured: ReturnType<typeof useTerminalSize> | undefined;

function Probe(): ReactNode {
  captured = useTerminalSize(chrome);

  return <text>probe</text>;
}

async function renderProbe(
  nextChrome: Parameters<typeof useTerminalSize>[0],
): Promise<Awaited<ReturnType<typeof testRender>>> {
  chrome = nextChrome;
  captured = undefined;

  const setup = await testRender(
    <ShellTestProviders>
      <Probe />
    </ShellTestProviders>,
    { width: 80, height: 24 },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

function readCaptured(): ReturnType<typeof useTerminalSize> {
  if (captured === undefined) {
    throw new Error("the terminal size was not captured");
  }

  return captured;
}

describe("useTerminalSize", () => {
  it("reports the terminal size and the content budget left by the chrome", async () => {
    const setup = await renderProbe({ reservedRows: 6, reservedColumns: 4 });

    expect(readCaptured()).toEqual({ width: 80, height: 24, visibleRows: 18, textBudget: 76 });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("reports the whole terminal when no chrome is reserved", async () => {
    const setup = await renderProbe(undefined);

    expect(readCaptured().visibleRows).toBe(24);
    expect(readCaptured().textBudget).toBe(80);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("floors a chrome larger than the terminal at zero", async () => {
    const setup = await renderProbe({ reservedRows: 30, reservedColumns: 100 });

    expect(readCaptured().visibleRows).toBe(0);
    expect(readCaptured().textBudget).toBe(0);

    await act(async () => {
      await setup.dispose();
    });
  });
});
