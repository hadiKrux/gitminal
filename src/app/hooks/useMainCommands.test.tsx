import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { useMainCommands } from "@/app/hooks/useMainCommands";
import { resetCommandRunner, runCommand } from "@/domain/commands/commands.runner";
import type { CommandRequest } from "@/domain/commands/commands.types";
import {
  createRepositorySignals,
  detectRepositoryState,
} from "@/domain/repository/repository.states";
import { createScriptedGitClient, fakeGitResult } from "@/test/git.fake";

/**
 * Mounts the registration hook without any provider.
 *
 * @returns A marker text node.
 */
function Harness(): ReactNode {
  useMainCommands();

  return <text>ready</text>;
}

/**
 * Renders the registration harness.
 *
 * @returns The renderer setup.
 */
async function renderHarness(): Promise<Awaited<ReturnType<typeof testRender>>> {
  const setup = await testRender(<Harness />, { width: 40, height: 5 });

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

/**
 * Builds the normal loaded signals used by the runner.
 *
 * @returns The signal set.
 */
function createSignals() {
  return createRepositorySignals({
    loaded: true,
    insideWorkTree: true,
    repositoryRoot: "/repo",
    cwd: "/repo",
    headExists: true,
    branch: "main",
    identity: { name: "Test", email: "test@example.com" },
    remotes: ["origin"],
    upstream: "origin/main",
    upstreamExists: true,
    upstreamCheck: "checked",
  });
}

beforeEach(() => {
  resetCommandRunner();
});

describe("useMainCommands", () => {
  it("registers the diff executors exactly once", async () => {
    const setup = await renderHarness();
    const fake = createScriptedGitClient({
      "add -- :(literal)a.txt": fakeGitResult(""),
    });
    const signals = createSignals();
    const request: CommandRequest = {
      commandId: "diff.stage",
      target: { kind: "diffFile", section: "working", path: "a.txt" },
    };

    const result = await runCommand(request, {
      state: detectRepositoryState(signals),
      signals,
      target: request.target,
      region: "diff",
      client: fake.client,
    });

    expect(result.status).toBe("success");
    expect(fake.calls[0]?.args).toEqual(["add", "--", ":(literal)a.txt"]);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("registers the commit executors exactly once", async () => {
    const setup = await renderHarness();
    const fake = createScriptedGitClient({
      "commit -m fix the parser": fakeGitResult(""),
    });
    const signals = createSignals();
    const request: CommandRequest = {
      commandId: "commit.submit",
      target: { kind: "none" },
      formValues: { message: "fix the parser" },
    };

    const result = await runCommand(request, {
      state: detectRepositoryState(signals),
      signals,
      target: request.target,
      region: "right-pane",
      client: fake.client,
    });

    expect(result.status).toBe("success");
    expect(fake.calls[0]?.args).toEqual(["commit", "-m", "fix the parser"]);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("passes no-verify and amend only for their own variants", async () => {
    const setup = await renderHarness();
    const fake = createScriptedGitClient({
      "commit --amend --no-verify -m amended": fakeGitResult(""),
    });
    const signals = createSignals();
    const request: CommandRequest = {
      commandId: "commit.amendNoVerify",
      target: { kind: "none" },
      formValues: { message: "amended" },
    };

    const result = await runCommand(request, {
      state: detectRepositoryState(signals),
      signals,
      target: request.target,
      region: "right-pane",
      client: fake.client,
    });

    expect(result.status).toBe("success");
    expect(fake.calls[0]?.args).toEqual(["commit", "--amend", "--no-verify", "-m", "amended"]);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("rejects a second mount instead of competing for the same command", async () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    const setup = await testRender(
      <box flexDirection="column">
        <Harness />
        <Harness />
      </box>,
      { width: 40, height: 5 },
    );

    await act(async () => {
      await setup.renderOnce();
    });

    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
    await act(async () => {
      await setup.dispose();
    });
  });
});
