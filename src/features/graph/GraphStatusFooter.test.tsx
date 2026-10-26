import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { GraphStatusFooter } from "@/features/graph/GraphStatusFooter";
import {
  GRAPH_LOAD_ERROR_MESSAGE,
  GRAPH_RETRY_ID,
  GRAPH_WALK_ERROR_MESSAGE,
  GRAPH_WALK_RETRY_ID,
} from "@/features/graph/graph.constants";
import { ShellTestProviders } from "@/test/shell.harness";

/**
 * Renders one status footer in a fixed box.
 *
 * @param node - Footer to render.
 * @param width - Footer and terminal width.
 * @param height - Footer box and terminal height.
 * @returns The renderer setup.
 */
async function renderFooter(
  node: ReactNode,
  width: number = 60,
  height: number = 12,
): Promise<Awaited<ReturnType<typeof testRender>>> {
  const setup = await testRender(
    <ShellTestProviders>
      <box flexDirection="column" width={width} height={height}>
        {node}
      </box>
    </ShellTestProviders>,
    { width, height },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

/**
 * Simulates one left mouse click on a renderable.
 *
 * @param setup - Renderer setup.
 * @param id - Renderable id of the target.
 */
async function click(setup: Awaited<ReturnType<typeof testRender>>, id: string): Promise<void> {
  const target = setup.renderer.root.findDescendantById(id);

  if (target === undefined) {
    throw new Error(`renderable ${id} is missing`);
  }

  const { MouseEvent } = await import("@opentui/core");

  target.processMouseEvent(
    new MouseEvent(target, {
      type: "down",
      button: 0,
      x: 1,
      y: 0,
      modifiers: { shift: false, alt: false, ctrl: false },
    }),
  );
}

describe("GraphStatusFooter", () => {
  it("renders a retryable walk error and a page error with distinct Retry ids", async () => {
    const setup = await renderFooter(
      <GraphStatusFooter
        isLoadingOlder={false}
        walkError={{ message: GRAPH_WALK_ERROR_MESSAGE, retryable: true }}
        pageError={GRAPH_LOAD_ERROR_MESSAGE}
        isDone
        width={60}
        onRetry={() => {}}
        onWalkRetry={() => {}}
      />,
    );
    const frame = setup.captureCharFrame();

    expect(frame).toContain(GRAPH_WALK_ERROR_MESSAGE);
    expect(frame).toContain(GRAPH_LOAD_ERROR_MESSAGE);
    expect(frame).toContain("Beginning of history");
    expect(frame).toContain("Retry");
    expect(setup.renderer.root.findDescendantById(GRAPH_WALK_RETRY_ID)).toBeDefined();
    expect(setup.renderer.root.findDescendantById(GRAPH_RETRY_ID)).toBeDefined();
    expect(GRAPH_WALK_RETRY_ID).not.toBe(GRAPH_RETRY_ID);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("bounds every row at the narrow graph width and keeps both Retry actions visible", async () => {
    const setup = await renderFooter(
      <GraphStatusFooter
        isLoadingOlder={false}
        walkError={{ message: GRAPH_WALK_ERROR_MESSAGE, retryable: true }}
        pageError="fatal: unable to read history because the object store is corrupt"
        isDone
        width={18}
        onRetry={() => {}}
        onWalkRetry={() => {}}
      />,
      18,
      12,
    );
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Retry");
    expect(frame).toContain("Beginning of");
    expect(frame).toContain("history");
    expect(frame).toContain(GRAPH_WALK_ERROR_MESSAGE.slice(0, 6));

    await act(async () => {
      await setup.dispose();
    });
  });

  it("bounds a long page error and details at the real 15-cell graph width", async () => {
    const details =
      "fatal: unable to read history because the object store is corrupt and a pack file is missing";

    const setup = await renderFooter(
      <GraphStatusFooter
        isLoadingOlder={false}
        walkError={null}
        pageError={details}
        isDone
        width={15}
        onRetry={() => {}}
        onWalkRetry={() => {}}
      />,
      15,
      12,
    );
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Retry");
    expect(setup.renderer.root.findDescendantById(GRAPH_RETRY_ID)).toBeDefined();
    expect(frame).toContain(GRAPH_LOAD_ERROR_MESSAGE.slice(0, 4));
    expect(frame).toContain("fatal:");
    expect(frame).not.toContain(details);
    expect(frame).toContain("...");

    for (const line of frame.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(15);
    }

    await act(async () => {
      await setup.dispose();
    });
  });

  it("dispatches the walk Retry and the page Retry to different callbacks", async () => {
    let pageRetries = 0;
    let walkRetries = 0;
    const setup = await renderFooter(
      <GraphStatusFooter
        isLoadingOlder={false}
        walkError={{ message: GRAPH_WALK_ERROR_MESSAGE, retryable: true }}
        pageError={GRAPH_LOAD_ERROR_MESSAGE}
        isDone={false}
        width={40}
        onRetry={() => {
          pageRetries += 1;
        }}
        onWalkRetry={() => {
          walkRetries += 1;
        }}
      />,
      40,
      12,
    );

    await act(async () => {
      await click(setup, GRAPH_WALK_RETRY_ID);
    });

    expect(walkRetries).toBe(1);
    expect(pageRetries).toBe(0);

    await act(async () => {
      await click(setup, GRAPH_RETRY_ID);
    });

    expect(walkRetries).toBe(1);
    expect(pageRetries).toBe(1);

    await act(async () => {
      await setup.dispose();
    });
  });
});
