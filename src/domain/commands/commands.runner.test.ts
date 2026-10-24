import { afterEach, describe, expect, it } from "bun:test";
import {
  isCommandRunning,
  registerCommandHandler,
  resetCommandRunner,
  runCommand,
} from "@/domain/commands/commands.runner";
import type {
  CommandExecutionOutcome,
  CommandHandler,
  CommandRequest,
  CommandRunOptions,
  CommandStepResult,
} from "@/domain/commands/commands.types";
import type { GitClient } from "@/domain/git/git.types";
import {
  createRepositorySignals,
  detectRepositoryState,
} from "@/domain/repository/repository.states";
import type { RepositorySignals } from "@/domain/repository/repository.types";

/** A client that is never invoked by these handlers. */
const UNUSED_CLIENT: GitClient = {
  gitPath: "git",
  invoke: async () => {
    throw new Error("the runner tests do not spawn git");
  },
};

/**
 * Builds a loaded, normal-repository signal set with overrides.
 *
 * @param overrides - Signal values to override.
 * @returns The signal set.
 */
function createSignals(overrides: Partial<RepositorySignals> = {}): RepositorySignals {
  return createRepositorySignals({
    loaded: true,
    insideWorkTree: true,
    repositoryRoot: "/repo",
    cwd: "/repo/sub",
    headExists: true,
    branch: "main",
    identity: { name: "Test User", email: "test@example.com" },
    remotes: ["origin"],
    upstream: "origin/main",
    upstreamExists: true,
    upstreamCheck: "checked",
    ...overrides,
  });
}

/**
 * Builds run options for the normal repository.
 *
 * @param overrides - Option overrides.
 * @returns The run options.
 */
function createOptions(overrides: Partial<CommandRunOptions> = {}): CommandRunOptions {
  const signals = overrides.signals ?? createSignals();

  return {
    state: overrides.state ?? detectRepositoryState(signals),
    signals,
    target: overrides.target ?? { kind: "none" },
    region: overrides.region ?? "branches",
    client: overrides.client ?? UNUSED_CLIENT,
    signal: overrides.signal,
    onProgress: overrides.onProgress,
  };
}

/**
 * Builds a request.
 *
 * @param commandId - Command id.
 * @param overrides - Request overrides.
 * @returns The request.
 */
function createRequest(commandId: string, overrides: Partial<CommandRequest> = {}): CommandRequest {
  return {
    commandId,
    target: overrides.target ?? { kind: "none" },
    formValues: overrides.formValues,
  };
}

/**
 * Builds one successful step.
 *
 * @param argv - Captured arguments.
 * @returns The step result.
 */
function okStep(argv: readonly string[]): CommandStepResult {
  return { argv, exitCode: 0, durationMs: 3, stdout: "", stderr: "" };
}

/**
 * Creates a promise plus its resolver.
 *
 * @returns The promise and a resolve function.
 */
function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolveFn: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    resolveFn = resolve;
  });

  return { promise, resolve: () => resolveFn() };
}

/**
 * Registers a handler that returns the supplied outcome.
 *
 * @param commandId - Command id.
 * @param outcome - Outcome to return.
 * @param calls - Optional call counter.
 * @returns The registration cleanup function.
 */
function registerOutcome(
  commandId: string,
  outcome: CommandExecutionOutcome,
  calls?: { count: number },
): () => void {
  return registerCommandHandler({
    commandId,
    operationLabel: "Test operation",
    handler: async () => {
      if (calls !== undefined) {
        calls.count += 1;
      }

      return outcome;
    },
  });
}

describe("runCommand", () => {
  afterEach(() => {
    resetCommandRunner();
  });

  it("returns a blocked result for an unknown command", async () => {
    const result = await runCommand(createRequest("nope.nothing"), createOptions());

    expect(result.status).toBe("blocked");
    expect(result.blockedReason).toBe("command-not-found");
    expect(result.steps).toHaveLength(0);
  });

  it("rejects a read command", async () => {
    const result = await runCommand(createRequest("app.refresh"), createOptions());

    expect(result.status).toBe("blocked");
    expect(result.blockedReason).toBe("not-a-mutation");
  });

  it("returns a blocked result when no handler is registered", async () => {
    const result = await runCommand(createRequest("branch.create"), createOptions());

    expect(result.status).toBe("blocked");
    expect(result.blockedReason).toBe("command-not-implemented");
  });

  it("re-checks availability before executing", async () => {
    const calls = { count: 0 };
    registerOutcome("branch.delete", { steps: [okStep(["git", "branch", "-d", "x"])] }, calls);

    const result = await runCommand(createRequest("branch.delete"), createOptions());

    expect(result.status).toBe("blocked");
    expect(result.blockedReason).toBe("missing-target");
    expect(calls.count).toBe(0);
  });

  it("executes a registered mutation from the repository root", async () => {
    registerCommandHandler({
      commandId: "branch.create",
      operationLabel: "Create branch",
      handler: async (context) => {
        expect(context.cwd).toBe("/repo");
        expect(context.signal.aborted).toBeFalse();

        return { steps: [okStep(["git", "switch", "-c", "feature"])] };
      },
    });

    const result = await runCommand(createRequest("branch.create"), createOptions());

    expect(result.status).toBe("success");
    expect(result.operationLabel).toBe("Create branch");
    expect(result.cwd).toBe("/repo");
    expect(result.steps).toHaveLength(1);
    expect(isCommandRunning()).toBeFalse();
  });

  it("collects and forwards progress events", async () => {
    const forwarded: string[] = [];
    registerCommandHandler({
      commandId: "remote.fetch",
      operationLabel: "Fetch",
      handler: async (context) => {
        context.notifyProgress({ phase: "receiving objects", percent: 40 });
        context.notifyProgress({ phase: "resolving deltas", percent: 80 });

        return { steps: [okStep(["git", "fetch", "--progress", "origin"])] };
      },
    });

    const result = await runCommand(
      createRequest("remote.fetch"),
      createOptions({ onProgress: (progress) => forwarded.push(progress.phase) }),
    );

    expect(result.progress).toEqual([
      { phase: "receiving objects", percent: 40 },
      { phase: "resolving deltas", percent: 80 },
    ]);
    expect(forwarded).toEqual(["receiving objects", "resolving deltas"]);
  });

  it("reports a git failure without throwing", async () => {
    registerOutcome("branch.create", {
      steps: [
        {
          argv: ["git", "switch", "-c", "feature"],
          exitCode: 128,
          durationMs: 4,
          stdout: "",
          stderr: "fatal: a branch named 'feature' already exists",
        },
      ],
    });

    const result = await runCommand(createRequest("branch.create"), createOptions());

    expect(result.status).toBe("failure");
    expect(result.steps[0]?.stderr).toContain("already exists");
  });

  it("marks a non-fatal step successful and keeps its warnings", async () => {
    registerOutcome("remote.fetch", {
      steps: [
        {
          ...okStep(["git", "fetch", "--progress", "origin", "refs/heads/feature"]),
          exitCode: 128,
          stderr: "fatal: couldn't find remote ref refs/heads/feature",
          nonFatal: true,
        },
      ],
      warnings: ["upstream not found for origin/feature"],
    });

    const result = await runCommand(createRequest("remote.fetch"), createOptions());

    expect(result.status).toBe("success");
    expect(result.warnings).toEqual(["upstream not found for origin/feature"]);
    expect(result.steps[0]?.nonFatal).toBeTrue();
  });

  it("returns a blocked result when the handler refuses its scope", async () => {
    registerOutcome("remote.fetch", { steps: [], blockedReason: "no-local-upstreams" });

    const result = await runCommand(createRequest("remote.fetch"), createOptions());

    expect(result.status).toBe("blocked");
    expect(result.blockedReason).toBe("no-local-upstreams");
    expect(result.steps).toHaveLength(0);
  });

  it("marks a cancelled outcome as a failure and never success", async () => {
    registerOutcome("branch.create", {
      steps: [{ ...okStep(["git", "switch", "-c", "feature"]), cancelled: true }],
      cancelled: true,
    });

    const result = await runCommand(createRequest("branch.create"), createOptions());

    expect(result.status).toBe("failure");
    expect(result.cancelled).toBeTrue();
  });

  it("marks a timed-out outcome as a failure", async () => {
    registerOutcome("remote.fetch", {
      steps: [{ ...okStep(["git", "fetch"]), timedOut: true }],
      timedOut: true,
    });

    const result = await runCommand(createRequest("remote.fetch"), createOptions());

    expect(result.status).toBe("failure");
    expect(result.timedOut).toBeTrue();
  });

  it("blocks a second mutation while one is running", async () => {
    const gate = createDeferred();
    const started = { count: 0 };
    const handler: CommandHandler = async () => {
      started.count += 1;
      await gate.promise;

      return { steps: [okStep(["git", "switch", "-c", "feature"])] };
    };
    registerCommandHandler({
      commandId: "branch.create",
      operationLabel: "Create branch",
      handler,
    });

    const first = runCommand(createRequest("branch.create"), createOptions());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(isCommandRunning()).toBeTrue();

    const second = await runCommand(createRequest("branch.create"), createOptions());

    expect(second.status).toBe("blocked");
    expect(second.blockedReason).toBe("operation-in-progress");
    expect(started.count).toBe(1);

    gate.resolve();
    const firstResult = await first;

    expect(firstResult.status).toBe("success");
    expect(isCommandRunning()).toBeFalse();
  });

  it("releases the latch after a failure so the next mutation can run", async () => {
    let call = 0;
    registerCommandHandler({
      commandId: "branch.create",
      operationLabel: "Create branch",
      handler: async () => {
        call += 1;

        return {
          steps: [
            {
              argv: ["git", "switch", "-c", "feature"],
              exitCode: call === 1 ? 1 : 0,
              durationMs: 1,
              stdout: "",
              stderr: call === 1 ? "fatal: nope" : "",
            },
          ],
        };
      },
    });

    expect((await runCommand(createRequest("branch.create"), createOptions())).status).toBe(
      "failure",
    );
    expect((await runCommand(createRequest("branch.create"), createOptions())).status).toBe(
      "success",
    );
  });

  it("converts a thrown handler into a failure result", async () => {
    registerCommandHandler({
      commandId: "branch.create",
      operationLabel: "Create branch",
      handler: async () => {
        throw new Error("unexpected defect");
      },
    });

    const result = await runCommand(createRequest("branch.create"), createOptions());

    expect(result.status).toBe("failure");
    expect(result.steps[0]?.stderr).toBe("unexpected defect");
  });

  it("forwards caller cancellation to the handler signal", async () => {
    const controller = new AbortController();
    registerCommandHandler({
      commandId: "branch.create",
      operationLabel: "Create branch",
      handler: async (context) => {
        await new Promise<void>((resolve) => {
          context.signal.addEventListener("abort", () => resolve(), { once: true });
        });

        return { steps: [{ ...okStep(["git", "switch"]), cancelled: true }], cancelled: true };
      },
    });

    const pending = runCommand(
      createRequest("branch.create"),
      createOptions({ signal: controller.signal }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    const result = await pending;

    expect(result.cancelled).toBeTrue();
    expect(result.status).toBe("failure");
  });

  it("stops a command handler when its registration is removed", async () => {
    const remove = registerOutcome("branch.create", { steps: [] });

    remove();

    const result = await runCommand(createRequest("branch.create"), createOptions());

    expect(result.blockedReason).toBe("command-not-implemented");
  });
});
