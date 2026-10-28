import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, useState } from "react";
import { ShellTestProviders } from "@/test/shell.harness";
import { FormField } from "@/ui/FormField";
import { ModalActions } from "@/ui/ModalActions";
import { ModalFrame } from "@/ui/ModalFrame";
import { MODAL_FRAME_ID } from "@/ui/ModalFrame.constants";
import { SelectField } from "@/ui/SelectField";

let setError: (value: string | undefined) => void = () => {};

function ValidationHarness() {
  const [error, updateError] = useState<string>();
  setError = updateError;

  return (
    <ShellTestProviders>
      <ModalFrame title="Create" width={40}>
        <FormField label="Name" error={error} />
        <ModalActions actions={[{ label: "Cancel" }]} />
      </ModalFrame>
    </ShellTestProviders>
  );
}

describe("ModalFrame", () => {
  it("fits content with consistent padding, gaps, and a centered footer", async () => {
    const setup = await testRender(
      <ShellTestProviders>
        <ModalFrame title="Create" width={50}>
          <FormField id="modal-input" label="Name" value="topic" />
          <ModalActions actions={[{ id: "modal-cancel", label: "Cancel" }]} />
        </ModalFrame>
      </ShellTestProviders>,
      { width: 100, height: 30 },
    );

    await act(async () => {
      await setup.renderOnce();
    });

    const modal = setup.renderer.root.findDescendantById(MODAL_FRAME_ID);
    const input = setup.renderer.root.findDescendantById("modal-input");
    const cancel = setup.renderer.root.findDescendantById("modal-cancel");

    if (modal === undefined || input === undefined || cancel === undefined) {
      throw new Error("Modal frame, input, and cancel button must be mounted");
    }

    expect(modal.height).toBe(8);
    expect(modal.x).toBe(25);
    expect(Math.abs(modal.y * 2 + modal.height - 30)).toBeLessThanOrEqual(1);
    expect(input.x).toBe(modal.x + 2);
    expect(input.y).toBe(modal.y + 3);
    expect(cancel.y).toBe(input.y + 2);
    expect(cancel.y + cancel.height).toBe(modal.y + 6);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("grows for wrapped validation and shrinks when it clears", async () => {
    const setup = await testRender(<ValidationHarness />, { width: 80, height: 30 });

    await act(async () => {
      await setup.renderOnce();
    });

    const modal = setup.renderer.root.findDescendantById(MODAL_FRAME_ID);
    const initialHeight = modal?.height ?? 0;

    await act(async () => {
      setError("A local branch with this name already exists. Choose another name.");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(modal?.height).toBe(initialHeight + 2);
    expect(setup.captureCharFrame()).toContain("Choose another name.");
    expect(setup.captureCharFrame()).toContain("Cancel");

    await act(async () => {
      setError(undefined);
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(modal?.height).toBe(initialHeight);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("clamps option lists and restores their natural height on resize", async () => {
    const setup = await testRender(
      <ShellTestProviders>
        <ModalFrame title="Options" width={60}>
          <SelectField
            id="modal-options"
            height={20}
            options={Array.from({ length: 20 }, (_, index) => ({
              label: `Option ${index}`,
              value: String(index),
            }))}
          />
        </ModalFrame>
      </ShellTestProviders>,
      { width: 100, height: 40 },
    );

    await act(async () => {
      await setup.renderOnce();
    });

    const modal = setup.renderer.root.findDescendantById(MODAL_FRAME_ID);

    expect(modal?.height).toBe(24);

    await act(async () => {
      setup.resize(50, 16);
      await setup.renderOnce();
    });

    expect(modal?.width).toBe(42);
    expect(modal?.height).toBe(12);
    expect(setup.renderer.root.findDescendantById("modal-options")?.height).toBe(8);

    await act(async () => {
      setup.resize(100, 40);
      await setup.renderOnce();
    });

    expect(modal?.height).toBe(24);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps explicitly sized scroll surfaces bounded by the terminal", async () => {
    const setup = await testRender(
      <ShellTestProviders>
        <ModalFrame title="Help" width={90} height={26}>
          <scrollbox flexGrow={1}>
            <text>{"Help content\n".repeat(40)}</text>
          </scrollbox>
          <ModalActions actions={[{ id: "close-help", label: "Close" }]} />
        </ModalFrame>
      </ShellTestProviders>,
      { width: 80, height: 24 },
    );

    await act(async () => {
      await setup.renderOnce();
    });

    const modal = setup.renderer.root.findDescendantById(MODAL_FRAME_ID);
    const close = setup.renderer.root.findDescendantById("close-help");

    expect(modal?.height).toBe(20);
    expect(modal?.width).toBe(72);
    expect(close?.y).toBeLessThan((modal?.y ?? 0) + (modal?.height ?? 0) - 1);
    expect(setup.captureCharFrame()).toContain("Close");

    await act(async () => {
      await setup.dispose();
    });
  });
});
