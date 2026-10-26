import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode, useState } from "react";
import { useDebouncedValue } from "@/app/hooks/useDebouncedValue";
import { ShellTestProviders } from "@/test/shell.harness";

let latest = "";
let setValue: (value: string) => void = () => {};
const history: string[] = [];

function Probe(): ReactNode {
  const [value, setProbeValue] = useState("first");
  const debounced = useDebouncedValue(value, 20);

  setValue = setProbeValue;
  latest = debounced;
  history.push(debounced);

  return <text>{debounced}</text>;
}

describe("useDebouncedValue", () => {
  it("keeps the previous value until the quiet interval elapses", async () => {
    latest = "";
    history.length = 0;

    const setup = await testRender(
      <ShellTestProviders>
        <Probe />
      </ShellTestProviders>,
      { width: 30, height: 4 },
    );

    await act(async () => {
      await setup.renderOnce();
    });

    expect(latest).toBe("first");

    await act(async () => {
      setValue("second");
      setValue("third");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latest).toBe("first");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latest).toBe("third");
    expect(history).not.toContain("second");

    await act(async () => {
      await setup.dispose();
    });
  });
});
