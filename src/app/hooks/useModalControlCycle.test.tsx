import { beforeEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { resetActionRegistry, resolveActionHandler } from "@/app/hooks/useAction";
import { useModalControlCycle } from "@/app/hooks/useModalControlCycle";
import type { ModalControlCycleOptions } from "@/app/hooks/useModalControlCycle.types";
import { ShellTestProviders } from "@/test/shell.harness";

type TestControl = "scope" | "force" | "cancel" | "confirm";

const ORDER: readonly TestControl[] = ["scope", "force", "cancel", "confirm"];

let latest: TestControl | undefined;

function Harness(props: { readonly options: ModalControlCycleOptions<TestControl> }): ReactNode {
  const cycle = useModalControlCycle(props.options);
  latest = cycle.control;

  return <text>{cycle.control}</text>;
}

/**
 * Renders the cycle harness.
 *
 * @param onHorizontal - Optional horizontal rule under test.
 * @returns The renderer setup.
 */
async function renderCycle(
  onHorizontal?: ModalControlCycleOptions<TestControl>["onHorizontal"],
): Promise<Awaited<ReturnType<typeof testRender>>> {
  const setup = await testRender(
    <ShellTestProviders>
      <Harness options={{ order: ORDER, initial: "cancel", onHorizontal }} />
    </ShellTestProviders>,
    { width: 60, height: 10 },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

/**
 * Runs one overlay action and flushes the render it causes.
 *
 * @param setup - Renderer setup.
 * @param actionId - Overlay action to resolve.
 */
async function runAction(
  setup: Awaited<ReturnType<typeof testRender>>,
  actionId: string,
): Promise<void> {
  await act(async () => {
    resolveActionHandler(actionId, "overlay")?.();
  });
  await act(async () => {
    await setup.renderOnce();
  });
}

beforeEach(() => {
  resetActionRegistry();
  latest = undefined;
});

describe("useModalControlCycle", () => {
  it("registers the four navigation actions in the overlay scope", async () => {
    const setup = await renderCycle();

    for (const actionId of ["nav.up", "nav.down", "nav.left", "nav.right"]) {
      expect(resolveActionHandler(actionId, "overlay")).toBeDefined();
    }

    await act(async () => {
      await setup.dispose();
    });
  });

  it("steps through the visible order and clamps at both ends", async () => {
    const setup = await renderCycle();

    expect(latest).toBe("cancel");

    await runAction(setup, "nav.down");
    expect(latest).toBe("confirm");

    await runAction(setup, "nav.down");
    expect(latest).toBe("confirm");

    await runAction(setup, "nav.up");
    expect(latest).toBe("cancel");

    await runAction(setup, "nav.up");
    expect(latest).toBe("force");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("applies a caller horizontal focus rule", async () => {
    const setup = await renderCycle(({ control, direction }) => {
      if (direction === "right") {
        return { kind: "focus", control: "confirm" };
      }

      return control === "confirm" ? { kind: "focus", control: "cancel" } : { kind: "none" };
    });

    await runAction(setup, "nav.right");
    expect(latest).toBe("confirm");

    await runAction(setup, "nav.left");
    expect(latest).toBe("cancel");

    await runAction(setup, "nav.left");
    expect(latest).toBe("cancel");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("applies a caller horizontal step rule and ignores a no-op rule", async () => {
    const setup = await renderCycle(({ direction }) =>
      direction === "left" ? { kind: "step", delta: -1 } : { kind: "none" },
    );

    await runAction(setup, "nav.left");
    expect(latest).toBe("force");

    await runAction(setup, "nav.right");
    expect(latest).toBe("force");

    await act(async () => {
      await setup.dispose();
    });
  });
});
