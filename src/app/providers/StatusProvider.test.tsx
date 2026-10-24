import { beforeEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { useStatus } from "@/app/hooks/useStatus";
import { StatusProvider } from "@/app/providers/StatusProvider";
import type { StatusContextValue } from "@/app/providers/StatusProvider.types";

/** Latest status context captured by the probe. */
let latest: StatusContextValue | undefined;

/**
 * Captures the status context.
 *
 * @returns A non-focusable marker.
 */
function StatusProbe(): ReactNode {
  latest = useStatus();

  return (
    <text id="status-probe">{latest.status?.message ?? latest.operation?.phase ?? "idle"}</text>
  );
}

/**
 * Renders the status provider with the probe.
 *
 * @returns The renderer setup.
 */
async function renderStatus(): Promise<Awaited<ReturnType<typeof testRender>>> {
  latest = undefined;

  return testRender(
    <StatusProvider>
      <StatusProbe />
    </StatusProvider>,
    { width: 40, height: 10 },
  );
}

beforeEach(() => {
  latest = undefined;
});

describe("StatusProvider", () => {
  it("shows a transient status and dismisses it on its timer", async () => {
    const setup = await renderStatus();

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      latest?.setStatus({ kind: "success", message: "fetched" }, 10);
    });

    expect(latest?.status).toEqual({ kind: "success", message: "fetched" });

    const deadline = Date.now() + 1000;

    while (latest?.status !== null && Date.now() < deadline) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }

    expect(latest?.status).toBeNull();
    expect(Date.now()).toBeLessThan(deadline);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("clears a status manually and cancels its timer", async () => {
    const setup = await renderStatus();

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      latest?.setStatus({ kind: "info", message: "ready" }, 1000);
    });
    await act(async () => {
      latest?.clearStatus();
    });

    expect(latest?.status).toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("tracks operation start, progress, and end", async () => {
    const setup = await renderStatus();

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      latest?.beginOperation("fetch");
    });

    expect(latest?.operation).toEqual({ label: "fetch", phase: "fetch", percent: null });

    await act(async () => {
      latest?.updateOperation({ phase: "receiving objects", percent: 42 });
    });

    expect(latest?.operation).toEqual({
      label: "fetch",
      phase: "receiving objects",
      percent: 42,
    });

    await act(async () => {
      latest?.updateOperation({ percent: null });
    });

    expect(latest?.operation?.percent).toBeNull();

    await act(async () => {
      latest?.endOperation();
    });

    expect(latest?.operation).toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("switches the footer hint mode", async () => {
    const setup = await renderStatus();

    await act(async () => {
      await setup.renderOnce();
    });

    expect(latest?.hintMode).toBe("context");

    await act(async () => {
      latest?.setHintMode("modal");
    });

    expect(latest?.hintMode).toBe("modal");

    await act(async () => {
      await setup.dispose();
    });
  });
});
