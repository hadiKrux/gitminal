import { describe, expect, it } from "bun:test";
import type { InputRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode, useState } from "react";
import { RemoteFilter } from "@/features/remotes/RemoteFilter";
import {
  REMOTES_FILTER_INPUT_ID,
  REMOTES_FILTER_PLACEHOLDER,
} from "@/features/remotes/RemoteFilter.constants";
import { ShellTestProviders } from "@/test/shell.harness";

/** Latest value reported by the field. */
let reportedValue = "";

/** Setter that lets a test replace the controlled value from outside the field. */
let setExternalValue: (value: string) => void = () => {};

/**
 * Renders the filter with lifted state, mirroring `useRemotes`.
 *
 * @returns The filter field.
 */
function Harness(): ReactNode {
  const [value, setValue] = useState("");

  reportedValue = value;
  setExternalValue = setValue;

  return (
    <box flexDirection="column" width={40} height={3}>
      <RemoteFilter value={value} onChange={setValue} />
    </box>
  );
}

/**
 * Reads the native input renderable by its stable id.
 *
 * @param setup - Renderer setup.
 * @returns The filter input.
 */
function readInput(setup: Awaited<ReturnType<typeof testRender>>): InputRenderable {
  const input = setup.renderer.root.findDescendantById(REMOTES_FILTER_INPUT_ID) as
    | InputRenderable
    | undefined;

  if (input === undefined) {
    throw new Error("remotes filter input is missing");
  }

  return input;
}

describe("RemoteFilter", () => {
  it("renders the placeholder and lifts typed text unchanged", async () => {
    const setup = await testRender(
      <ShellTestProviders>
        <Harness />
      </ShellTestProviders>,
      { width: 40, height: 3 },
    );

    await act(async () => {
      await setup.renderOnce();
    });

    const input = readInput(setup);

    expect(input.placeholder).toBe(REMOTES_FILTER_PLACEHOLDER);
    expect(input.value).toBe("");

    await act(async () => {
      input.insertText("ORIGIN/Ma");
    });

    expect(reportedValue).toBe("ORIGIN/Ma");
    expect(readInput(setup).value).toBe("ORIGIN/Ma");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("follows an external clear of the lifted value", async () => {
    const setup = await testRender(
      <ShellTestProviders>
        <Harness />
      </ShellTestProviders>,
      { width: 40, height: 3 },
    );

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      readInput(setup).insertText("main");
    });

    expect(readInput(setup).value).toBe("main");

    await act(async () => {
      setExternalValue("");
    });

    expect(readInput(setup).value).toBe("");

    await act(async () => {
      await setup.dispose();
    });
  });
});
