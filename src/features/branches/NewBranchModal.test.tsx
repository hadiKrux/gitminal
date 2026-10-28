import { beforeEach, describe, expect, it } from "bun:test";
import type { InputRenderable } from "@opentui/core";
import { MouseEvent } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { resetActionRegistry } from "@/app/hooks/useAction";
import { NewBranchModal } from "@/features/branches/NewBranchModal";
import { ShellTestProviders } from "@/test/shell.harness";
import { ICONS } from "@/theme/icons";
import { MODAL_FRAME_ID } from "@/ui/ModalFrame.constants";

const NAME_FIELD_ID = "branch-name";
const CHECKOUT_ID = "branches-new-checkout";
const CANCEL_ID = "branches-new-cancel";

let created: { readonly name: string; readonly checkout: boolean } | undefined;
let closed = 0;

function Harness(props: { readonly existingBranchNames?: readonly string[] }): ReactNode {
  return (
    <ShellTestProviders>
      <NewBranchModal
        nameFieldId={NAME_FIELD_ID}
        startPointLabel="HEAD (current tip)"
        existingBranchNames={props.existingBranchNames ?? []}
        blockedReason={null}
        onClose={() => {
          closed += 1;
        }}
        onCreate={(input) => {
          created = input;
        }}
      />
    </ShellTestProviders>
  );
}

async function renderModal(
  props: { readonly existingBranchNames?: readonly string[] } = {},
): Promise<Awaited<ReturnType<typeof testRender>>> {
  const setup = await testRender(<Harness {...props} />, { width: 100, height: 30 });

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

function readInput(setup: Awaited<ReturnType<typeof testRender>>): InputRenderable {
  const input = setup.renderer.root.findDescendantById(NAME_FIELD_ID) as
    | InputRenderable
    | undefined;

  if (input === undefined) {
    throw new Error("branch name input is missing");
  }

  return input;
}

function click(setup: Awaited<ReturnType<typeof testRender>>, id: string): void {
  const box = setup.renderer.root.findDescendantById(id);

  if (box === undefined) {
    throw new Error(`${id} is missing`);
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

beforeEach(() => {
  resetActionRegistry();
  created = undefined;
  closed = 0;
});

describe("NewBranchModal", () => {
  it("renders the read-only start point, a checked checkout box, and submits on Enter", async () => {
    const setup = await renderModal();
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Branch name");
    expect(frame).toContain("Start point: HEAD (current tip)");
    expect(frame).toContain(`${ICONS.checkboxOn} Check out after creating`);
    expect(frame).toContain("Create");
    expect(frame).toContain("Cancel");

    await act(async () => {
      readInput(setup).insertText("feature/next");
    });
    await act(async () => {
      readInput(setup).submit();
    });

    expect(created).toEqual({ name: "feature/next", checkout: true });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("uses a compact padded layout with a separated footer", async () => {
    const setup = await renderModal();
    const modal = setup.renderer.root.findDescendantById(MODAL_FRAME_ID);
    const input = readInput(setup);
    const cancel = setup.renderer.root.findDescendantById(CANCEL_ID);
    const checkout = setup.renderer.root.findDescendantById(CHECKOUT_ID);

    expect(modal?.height).toBe(11);
    expect(input.x).toBe((modal?.x ?? 0) + 2);
    expect(input.y).toBe((modal?.y ?? 0) + 3);
    expect(cancel?.y).toBe((checkout?.y ?? 0) + 2);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("clears validation while correcting the name and shrinks back to fit", async () => {
    const setup = await renderModal();

    await act(async () => {
      readInput(setup).submit();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).toContain("Enter a branch name");
    expect(setup.renderer.root.findDescendantById(MODAL_FRAME_ID)?.height).toBe(12);

    await act(async () => {
      readInput(setup).insertText("feature/fixed");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).not.toContain("Enter a branch name");
    expect(setup.renderer.root.findDescendantById(MODAL_FRAME_ID)?.height).toBe(11);
    expect(created).toBeUndefined();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("rejects a name with whitespace inline without submitting", async () => {
    const setup = await renderModal();

    await act(async () => {
      readInput(setup).insertText("bad name");
    });
    await act(async () => {
      readInput(setup).submit();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(created).toBeUndefined();
    expect(setup.captureCharFrame()).toContain("Branch name is not a valid git ref");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("rejects HEAD, composite .lock components, and @{ through the shared validator", async () => {
    for (const name of ["HEAD", "foo.lock/bar", "a/b.lock", "@{"]) {
      const setup = await renderModal();

      await act(async () => {
        readInput(setup).insertText(name);
      });
      await act(async () => {
        readInput(setup).submit();
      });
      await act(async () => {
        await setup.renderOnce();
      });

      expect(created).toBeUndefined();
      expect(setup.captureCharFrame()).toContain("Branch name is not a valid git ref");

      await act(async () => {
        await setup.dispose();
      });
    }
  });

  it("submits checkout false after the checkbox is cleared", async () => {
    const setup = await renderModal();

    await act(async () => {
      readInput(setup).insertText("next");
    });
    await act(async () => {
      click(setup, CHECKOUT_ID);
    });
    await act(async () => {
      readInput(setup).submit();
    });

    expect(created).toEqual({ name: "next", checkout: false });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps Cancel reachable and closes the modal", async () => {
    const setup = await renderModal();

    await act(async () => {
      click(setup, CANCEL_ID);
    });

    expect(closed).toBe(1);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("refuses an existing local branch name inline", async () => {
    const setup = await renderModal({ existingBranchNames: ["main", "feature"] });

    await act(async () => {
      readInput(setup).insertText("feature");
    });
    await act(async () => {
      readInput(setup).submit();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(created).toBeUndefined();
    expect(setup.captureCharFrame()).toContain("A local branch with this name already exists");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows the availability reason and refuses to submit when blocked", async () => {
    const setup = await testRender(
      <ShellTestProviders>
        <NewBranchModal
          nameFieldId={NAME_FIELD_ID}
          startPointLabel="HEAD (current tip)"
          existingBranchNames={[]}
          blockedReason="no commits yet"
          onClose={() => {
            closed += 1;
          }}
          onCreate={(input) => {
            created = input;
          }}
        />
      </ShellTestProviders>,
      { width: 100, height: 30 },
    );

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      readInput(setup).insertText("next");
    });
    await act(async () => {
      readInput(setup).submit();
    });

    expect(created).toBeUndefined();
    expect(setup.captureCharFrame()).toContain("no commits yet");

    await act(async () => {
      await setup.dispose();
    });
  });
});
