import { describe, expect, it } from "bun:test";
import type { InputRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode, useState } from "react";
import { ShellTestProviders } from "@/test/shell.harness";
import { SearchField } from "@/ui/SearchField";

let currentValue = "";
let submittedValue = "";
let setExternalValue: (value: string) => void = () => {};

function Harness(): ReactNode {
  const [value, setValue] = useState("");

  currentValue = value;
  setExternalValue = setValue;

  return (
    <ShellTestProviders>
      <box flexDirection="column" width={40} height={3}>
        <SearchField
          id="filter"
          value={value}
          placeholder="Filter tags"
          onInput={setValue}
          onSubmit={(next) => {
            submittedValue = next;
          }}
        />
      </box>
    </ShellTestProviders>
  );
}

function readInput(setup: Awaited<ReturnType<typeof testRender>>): InputRenderable {
  const input = setup.renderer.root.findDescendantById("filter") as InputRenderable | undefined;

  if (input === undefined) {
    throw new Error("search field is missing");
  }

  return input;
}

describe("SearchField", () => {
  it("starts empty with the caller placeholder and reports typed input", async () => {
    const setup = await testRender(<Harness />, { width: 40, height: 3 });

    await act(async () => {
      await setup.renderOnce();
    });

    const input = readInput(setup);

    expect(input.value).toBe("");
    expect(input.placeholder).toBe("Filter tags");

    await act(async () => {
      input.insertText("main");
    });

    expect(currentValue).toBe("main");
    expect(input.value).toBe("main");

    await act(async () => {
      input.submit();
    });

    expect(submittedValue).toBe("main");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("follows an external value change", async () => {
    const setup = await testRender(<Harness />, { width: 40, height: 3 });

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      setExternalValue("released");
    });

    expect(readInput(setup).value).toBe("released");

    await act(async () => {
      await setup.dispose();
    });
  });
});
