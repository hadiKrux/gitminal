import { describe, expect, it } from "bun:test";
import { MouseEvent } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { ShellTestProviders } from "@/test/shell.harness";
import { ICONS } from "@/theme/icons";
import { ErrorState } from "@/ui/ErrorState";

async function renderErrorState(node: ReactNode): Promise<Awaited<ReturnType<typeof testRender>>> {
  const setup = await testRender(
    <ShellTestProviders>
      <box flexDirection="column" width={40} height={8}>
        {node}
      </box>
    </ShellTestProviders>,
    { width: 40, height: 8 },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

describe("ErrorState", () => {
  it("renders the marked message, the details, and a Retry button", async () => {
    const setup = await renderErrorState(
      <ErrorState
        message="Could not read branches"
        details="fatal: bad object"
        onRetry={() => {}}
      />,
    );
    const frame = setup.captureCharFrame();

    expect(frame).toContain(`${ICONS.error} Could not read branches`);
    expect(frame).toContain("fatal: bad object");
    expect(frame).toContain("Retry");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("runs the retry callback from the button", async () => {
    let retries = 0;
    const setup = await renderErrorState(
      <ErrorState
        message="Could not read tags"
        onRetry={() => {
          retries += 1;
        }}
        retryId="retry-tags"
      />,
    );
    const button = setup.renderer.root.findDescendantById("retry-tags");

    if (button === undefined) {
      throw new Error("retry button is missing");
    }

    await act(async () => {
      button.processMouseEvent(
        new MouseEvent(button, {
          type: "down",
          button: 0,
          x: 0,
          y: 0,
          modifiers: { shift: false, alt: false, ctrl: false },
        }),
      );
    });

    expect(retries).toBe(1);

    await act(async () => {
      await setup.dispose();
    });
  });
});
