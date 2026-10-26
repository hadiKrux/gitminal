import { describe, expect, it } from "bun:test";
import type { InputRenderable, TextareaRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { ShellTestProviders } from "@/test/shell.harness";
import { ICONS } from "@/theme/icons";
import { FormField } from "@/ui/FormField";

async function renderField(node: ReactNode): Promise<Awaited<ReturnType<typeof testRender>>> {
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

describe("FormField", () => {
  it("renders a label, a controlled input, and inline error text", async () => {
    const setup = await renderField(
      <FormField id="name" label="Branch name" value="feature" error="name already exists" />,
    );
    const input = setup.renderer.root.findDescendantById("name") as InputRenderable | undefined;
    const frame = setup.captureCharFrame();

    expect(input?.value).toBe("feature");
    expect(frame).toContain("Branch name");
    expect(frame).toContain(`${ICONS.error} name already exists`);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("renders caller children instead of the built-in input", async () => {
    const setup = await renderField(
      <FormField label="Message">
        <textarea id="message" height={2} />
      </FormField>,
    );
    const textarea = setup.renderer.root.findDescendantById("message") as
      | TextareaRenderable
      | undefined;

    expect(textarea).toBeDefined();
    expect(setup.renderer.root.findDescendantById("name")).toBeUndefined();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("omits the error line when there is no error", async () => {
    const setup = await renderField(<FormField id="name" label="Tag name" />);

    expect(setup.captureCharFrame()).not.toContain(ICONS.error);

    await act(async () => {
      await setup.dispose();
    });
  });
});
