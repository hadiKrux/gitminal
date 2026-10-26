import { describe, expect, it } from "bun:test";
import type { ScrollBoxRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { ShellTestProviders } from "@/test/shell.harness";
import { ScrollableList } from "@/ui/ScrollableList";

describe("ScrollableList", () => {
  it("renders content in a plain, non-focusable scroll container", async () => {
    const setup = await testRender(
      <ShellTestProviders>
        <box flexDirection="column" width={30} height={5}>
          <ScrollableList id="details">
            <text>{"Stash summary"}</text>
            <text>{"Read-only details"}</text>
          </ScrollableList>
        </box>
      </ShellTestProviders>,
      { width: 30, height: 5 },
    );

    await act(async () => {
      await setup.renderOnce();
    });

    const list = setup.renderer.root.findDescendantById("details") as
      | ScrollBoxRenderable
      | undefined;
    const frame = setup.captureCharFrame();

    expect(list).toBeDefined();
    expect(list?.focusable).toBe(false);
    expect(frame).toContain("Stash summary");
    expect(frame).toContain("Read-only details");

    await act(async () => {
      await setup.dispose();
    });
  });
});
