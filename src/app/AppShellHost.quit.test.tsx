import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode, useEffect } from "react";
import { AppShellHost } from "@/app/AppShellHost";
import { resetActionRegistry } from "@/app/hooks/useAction";
import { useStatus } from "@/app/hooks/useStatus";
import { ConfigProvider } from "@/app/providers/ConfigProvider";
import { FocusProvider } from "@/app/providers/FocusProvider";
import { KeymapProvider } from "@/app/providers/KeymapProvider";
import { StatusProvider } from "@/app/providers/StatusProvider";
import type { StatusContextValue } from "@/app/providers/StatusProvider.types";
import { ThemeProvider } from "@/app/providers/ThemeProvider";

/** Latest status context captured by the probe. */
let latestStatus: StatusContextValue | undefined;

/**
 * Captures the status context and starts or ends a marked operation after mount.
 *
 * @param props - True to mark an operation as running.
 * @returns A non-focusable marker.
 */
function StatusProbe(props: { running: boolean }): ReactNode {
  const status = useStatus();
  const { beginOperation, endOperation } = status;

  latestStatus = status;

  useEffect(() => {
    if (!props.running) {
      return;
    }

    beginOperation("fetch");

    return () => {
      endOperation();
    };
  }, [beginOperation, endOperation, props.running]);

  return <text id="status-probe">{status.status?.message ?? "idle"}</text>;
}

/**
 * Renders the composition root with the production provider nesting.
 *
 * @param running - True to mark an operation as running before quitting.
 * @returns The renderer setup.
 */
async function renderHost(running: boolean): Promise<Awaited<ReturnType<typeof testRender>>> {
  latestStatus = undefined;

  return testRender(
    <ConfigProvider>
      <ThemeProvider>
        <KeymapProvider platform="linux">
          <FocusProvider>
            <StatusProvider>
              <box flexDirection="column" flexGrow={1} width={120} height={40}>
                <AppShellHost />
                <StatusProbe running={running} />
              </box>
            </StatusProvider>
          </FocusProvider>
        </KeymapProvider>
      </ThemeProvider>
    </ConfigProvider>,
    { width: 120, height: 40, exitOnCtrlC: false, kittyKeyboard: true },
  );
}

beforeEach(() => {
  resetActionRegistry();
});

describe("AppShellHost quit", () => {
  it("destroys the renderer on idle q", async () => {
    const setup = await renderHost(false);
    const destroy = spyOn(setup.renderer, "destroy").mockImplementation(() => {});

    await act(async () => {
      await setup.renderOnce();
    });
    await act(async () => {
      setup.mockInput.pressKey("q");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(destroy).toHaveBeenCalledTimes(1);

    destroy.mockRestore();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("blocks quit with a warning while an operation is marked as running", async () => {
    const setup = await renderHost(true);
    const destroy = spyOn(setup.renderer, "destroy").mockImplementation(() => {});

    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestStatus?.operation?.label).toBe("fetch");

    await act(async () => {
      setup.mockInput.pressKey("q");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(destroy).not.toHaveBeenCalled();
    expect(latestStatus?.status).toEqual({
      kind: "warning",
      message: "Wait for the running operation to finish before quitting.",
    });

    destroy.mockRestore();
    await act(async () => {
      await setup.dispose();
    });
  });
});
