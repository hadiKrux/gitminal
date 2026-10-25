import { beforeEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { resetActionRegistry } from "@/app/hooks/useAction";
import { capConsoleOutput } from "@/domain/console/console.buffer";
import type { ConsoleStepEntry } from "@/domain/console/console.types";
import { ConsoleOutput } from "@/features/console/ConsoleOutput";
import { ShellTestProviders } from "@/test/shell.harness";

/**
 * Builds one console step from capped output.
 *
 * @param stdout - Raw standard output.
 * @param stderr - Raw standard error.
 * @returns The console step.
 */
function step(stdout: string, stderr: string): ConsoleStepEntry {
  return {
    argv: ["git", "fetch"],
    exitCode: 1,
    durationMs: 5,
    stdout: capConsoleOutput(stdout, { maxLines: 6 }),
    stderr: capConsoleOutput(stderr, { maxLines: 6 }),
  };
}

/**
 * Renders the expanded output of one step.
 *
 * @param candidate - Console step.
 * @returns The renderer setup.
 */
async function renderOutput(
  candidate: ConsoleStepEntry,
): Promise<Awaited<ReturnType<typeof testRender>>> {
  return testRender(
    <ShellTestProviders>
      <ConsoleOutput steps={[candidate]} />
    </ShellTestProviders>,
    { width: 80, height: 20 },
  );
}

beforeEach(() => {
  resetActionRegistry();
});

describe("ConsoleOutput", () => {
  it("renders the stdout and stderr labels with the omitted-lines marker between the ends", async () => {
    const stdout = Array.from({ length: 20 }, (_, index) => `stdout line ${index + 1}`).join("\n");
    const setup = await renderOutput(step(stdout, "fatal: nope"));

    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();

    expect(frame).toContain("stdout");
    expect(frame).toContain("stderr");
    expect(frame).toContain("stdout line 1");
    expect(frame).toContain("stdout line 20");
    expect(frame).toContain("14 lines omitted");
    expect(frame).toContain("fatal: nope");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("renders a no-output state for an entry with empty output", async () => {
    const setup = await renderOutput(step("", ""));

    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).toContain("no output");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("renders only output that was already redacted before it reached the component", async () => {
    const setup = await renderOutput(step("", "fatal: https://[redacted]@example.com/repo.git"));

    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();

    expect(frame).toContain("[redacted]");
    expect(frame).not.toContain("secret");

    await act(async () => {
      await setup.dispose();
    });
  });
});
