import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { resolveActionHandler } from "@/app/hooks/useAction";
import { useCommandRunner } from "@/app/hooks/useCommandRunner";
import type { CommandFailureReport, CommandRunnerHook } from "@/app/hooks/useCommandRunner.types";
import { useConsoleLog } from "@/app/hooks/useConsoleLog";
import { useRepository, useRepositoryRefreshAction } from "@/app/hooks/useRepository";
import { useStatus } from "@/app/hooks/useStatus";
import { ConfigProvider } from "@/app/providers/ConfigProvider";
import { ConsoleProvider } from "@/app/providers/ConsoleProvider";
import type { ConsoleContextValue } from "@/app/providers/ConsoleProvider.types";
import { FocusProvider } from "@/app/providers/FocusProvider";
import { RepositoryProvider } from "@/app/providers/RepositoryProvider";
import { StatusProvider } from "@/app/providers/StatusProvider";
import type { StatusContextValue } from "@/app/providers/StatusProvider.types";
import { registerCommandHandler, resetCommandRunner } from "@/domain/commands/commands.runner";
import type {
  CommandExecutionOutcome,
  CommandRequest,
  CommandStepResult,
} from "@/domain/commands/commands.types";
import type { GitClient, GitInvocationResult, GitWatcherFactory } from "@/domain/git/git.types";

/** Latest runner handle captured by the probe. */
let latestRunner: CommandRunnerHook | undefined;

/** Latest status context captured by the probe. */
let latestStatus: StatusContextValue | undefined;

/** Latest console context captured by the probe. */
let latestConsole: ConsoleContextValue | undefined;

/** Error reports captured by the injected sink. */
let errorReports: CommandFailureReport[] = [];

/** Registered handler call count. */
let handlerCalls = 0;

/** Canonical status output for a normal repository. */
const STATUS_OUTPUT =
  "# branch.oid abc123\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +0 -0\0";

/**
 * Builds an invocation result.
 *
 * @param stdout - Captured output.
 * @param ok - Whether git exited cleanly.
 * @returns The synthetic result.
 */
function result(stdout: string, ok: boolean = true): GitInvocationResult {
  return {
    argv: ["git"],
    cwd: "/repo",
    exitCode: ok ? 0 : 1,
    terminationSignal: null,
    stdout,
    stderr: ok ? "" : "fatal: failed",
    durationMs: 0,
    cancelled: false,
    timedOut: false,
    timedOutAfterMs: null,
    spawnError: null,
    ok,
  };
}

/**
 * Creates a fake git client for provider reads with mutable status answers.
 *
 * @returns The client and its status read counter.
 */
function createFakeGit(): { client: GitClient; statusReads: () => number } {
  let statusReads = 0;
  const answers: Readonly<Record<string, () => GitInvocationResult>> = {
    "rev-parse --is-inside-work-tree": () => result("true\n"),
    "rev-parse --is-bare-repository --absolute-git-dir": () => result("false\n/repo/.git\n"),
    "rev-parse --show-toplevel": () => result("/repo\n"),
    "rev-parse --verify HEAD": () => result("abc123\n"),
    "symbolic-ref -q --short HEAD": () => result("main\n"),
    "rev-parse --verify --quiet MERGE_HEAD": () => result("", false),
    "rev-parse --verify --quiet REBASE_HEAD": () => result("", false),
    "rev-parse --verify --quiet CHERRY_PICK_HEAD": () => result("", false),
    "remote -v": () => result("origin\tgit@example.com:repo.git (fetch)\n"),
    "config user.name": () => result("Test User\n"),
    "config user.email": () => result("test@example.com\n"),
    "for-each-ref --format=%(upstream:short) refs/heads/main": () => result("origin/main\n"),
    "for-each-ref --format=%(upstream:short) refs/heads": () => result("origin/main\n"),
    "rev-parse --verify --quiet origin/main": () => result("abc123\n"),
  };

  return {
    statusReads: () => statusReads,
    client: {
      gitPath: "git",
      invoke: async (options) => {
        const key = options.args.join(" ");

        if (key === "status --porcelain=v2 --branch -z --untracked-files=all") {
          statusReads += 1;

          return result(STATUS_OUTPUT);
        }

        const answer = answers[key];

        return answer === undefined ? result("", false) : answer();
      },
    },
  };
}

/** Never starts a watcher in these tests. */
const NOOP_WATCHER: GitWatcherFactory = () => ({
  start(): void {},
  stop(): void {},
  status: { watching: false, mode: "git-dir", path: null, recursive: false, limitation: null },
});

/**
 * Builds one successful command step.
 *
 * @param overrides - Step values to override.
 * @returns The step.
 */
function okStep(overrides: Partial<CommandStepResult> = {}): CommandStepResult {
  return {
    argv: ["git", "fetch", "--progress", "origin"],
    exitCode: 0,
    durationMs: 10,
    stdout: "",
    stderr: "",
    ...overrides,
  };
}

/**
 * Registers a handler that returns the supplied outcome.
 *
 * @param commandId - Command id.
 * @param outcome - Outcome to return.
 * @returns A cleanup function.
 */
function registerOutcome(commandId: string, outcome: CommandExecutionOutcome): () => void {
  return registerCommandHandler({
    commandId,
    operationLabel: "Fetch",
    handler: async () => {
      handlerCalls += 1;

      return outcome;
    },
  });
}

/**
 * Captures the runner, status, and console contexts.
 *
 * @param props - Whether to use the default error sink.
 * @returns A non-focusable marker.
 */
function RunnerProbe(props: { withDefaultSink?: boolean }): ReactNode {
  latestStatus = useStatus();
  latestConsole = useConsoleLog();
  useRepository();
  useRepositoryRefreshAction();

  const captureError =
    props.withDefaultSink === true
      ? undefined
      : (report: CommandFailureReport): void => {
          errorReports.push(report);
        };

  latestRunner = useCommandRunner(
    captureError === undefined ? undefined : { onError: captureError },
  );

  return <text id="runner-probe">probe</text>;
}

/**
 * Renders the command orchestrator with its providers.
 *
 * @param options - Harness options.
 * @returns The renderer setup and the fake client.
 */
async function renderRunner(options: { withDefaultSink?: boolean } = {}): Promise<{
  setup: Awaited<ReturnType<typeof testRender>>;
  fake: ReturnType<typeof createFakeGit>;
}> {
  latestRunner = undefined;
  latestStatus = undefined;
  latestConsole = undefined;
  errorReports = [];
  handlerCalls = 0;

  const fake = createFakeGit();
  let setup: Awaited<ReturnType<typeof testRender>> | undefined;

  await act(async () => {
    setup = await testRender(
      <ConfigProvider>
        <RepositoryProvider
          cwd="/repo"
          gitClient={fake.client}
          createWatcher={NOOP_WATCHER}
          enableWatcher={false}
          now={() => 0}
        >
          <FocusProvider>
            <StatusProvider>
              <ConsoleProvider>
                <RunnerProbe withDefaultSink={options.withDefaultSink} />
              </ConsoleProvider>
            </StatusProvider>
          </FocusProvider>
        </RepositoryProvider>
      </ConfigProvider>,
      { width: 80, height: 20 },
    );
  });

  if (setup === undefined) {
    throw new Error("renderer setup missing");
  }

  const renderer = setup;
  const deadline = Date.now() + 2_000;

  while (!hasConsoleProbe() && Date.now() < deadline) {
    await act(async () => {
      await renderer.renderOnce();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    if (latestRunner !== undefined) {
      break;
    }
  }

  return { setup: renderer, fake };
}

/**
 * Reports whether the console probe has mounted.
 *
 * @returns True when the probe captured its context.
 */
function hasConsoleProbe(): boolean {
  return latestConsole !== undefined;
}

/**
 * Waits until the provider has finished its initial refresh.
 *
 * @param setup - Renderer setup.
 * @param fake - Fake client.
 * @returns A promise resolved after the initial status read.
 */
async function waitForInitialRead(
  setup: Awaited<ReturnType<typeof testRender>>,
  fake: ReturnType<typeof createFakeGit>,
): Promise<void> {
  const deadline = Date.now() + 2_000;

  while (fake.statusReads() === 0 && Date.now() < deadline) {
    await act(async () => {
      await setup.renderOnce();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

/** The fetch command request used by the success and failure cases. */
const FETCH_REQUEST: CommandRequest = { commandId: "remote.fetch", target: { kind: "none" } };

beforeEach(() => {
  resetCommandRunner();
  errorReports = [];
  handlerCalls = 0;
});

afterEach(() => {
  resetCommandRunner();
});

describe("useCommandRunner", () => {
  it("applies one refresh, one console entry, and a success status for a success", async () => {
    const cleanup = registerOutcome("remote.fetch", { steps: [okStep()] });
    const { setup, fake } = await renderRunner();

    await waitForInitialRead(setup, fake);
    const statusBefore = fake.statusReads();

    let outcome: Awaited<ReturnType<CommandRunnerHook["runCommand"]>> | undefined;

    await act(async () => {
      outcome = await latestRunner?.runCommand(FETCH_REQUEST);
    });

    expect(outcome?.status).toBe("success");
    expect(fake.statusReads()).toBe(statusBefore + 1);
    expect(latestConsole?.entries).toHaveLength(1);
    expect(latestConsole?.entries[0]?.status).toBe("success");
    expect(latestStatus?.status).toEqual({ kind: "success", message: "Fetch completed" });
    expect(latestStatus?.operation).toBeNull();
    expect(errorReports).toHaveLength(0);

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("refreshes, appends, and routes a failure to the error sink", async () => {
    const cleanup = registerOutcome("remote.fetch", {
      steps: [okStep({ exitCode: 128, stderr: "fatal: Authentication failed" })],
    });
    const { setup, fake } = await renderRunner();

    await waitForInitialRead(setup, fake);
    const statusBefore = fake.statusReads();

    await act(async () => {
      await latestRunner?.runCommand(FETCH_REQUEST);
    });

    expect(fake.statusReads()).toBe(statusBefore + 1);
    expect(latestConsole?.entries).toHaveLength(1);
    expect(latestConsole?.entries[0]?.status).toBe("failure");
    expect(errorReports).toHaveLength(1);
    expect(errorReports[0]?.message).toBe("fatal: Authentication failed");
    expect(latestStatus?.operation).toBeNull();

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps a missing upstream ref successful with a warning and no error surface", async () => {
    const cleanup = registerOutcome("remote.fetch", {
      steps: [
        okStep(),
        okStep({
          exitCode: 128,
          stderr: "fatal: couldn't find remote ref refs/heads/feature",
          nonFatal: true,
        }),
      ],
      warnings: ["upstream not found for feature"],
    });
    const { setup, fake } = await renderRunner();

    await waitForInitialRead(setup, fake);
    const statusBefore = fake.statusReads();

    await act(async () => {
      await latestRunner?.runCommand(FETCH_REQUEST);
    });

    expect(fake.statusReads()).toBe(statusBefore + 1);
    expect(latestConsole?.entries).toHaveLength(1);
    expect(latestConsole?.entries[0]?.status).toBe("success");
    expect(errorReports).toHaveLength(0);
    expect(latestStatus?.status).toEqual({
      kind: "warning",
      message: "upstream not found for feature",
    });
    expect(latestStatus?.operation).toBeNull();

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("treats a cancelled result as a warning with one refresh and one console entry", async () => {
    const cleanup = registerOutcome("remote.fetch", { steps: [], cancelled: true });
    const { setup, fake } = await renderRunner();

    await waitForInitialRead(setup, fake);
    const statusBefore = fake.statusReads();

    await act(async () => {
      await latestRunner?.runCommand(FETCH_REQUEST);
    });

    expect(fake.statusReads()).toBe(statusBefore + 1);
    expect(latestConsole?.entries).toHaveLength(1);
    expect(latestConsole?.entries[0]?.status).toBe("cancelled");
    expect(latestStatus?.status).toEqual({ kind: "warning", message: "cancelled" });
    expect(errorReports).toHaveLength(0);

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("treats a timed-out result as a warning, never success", async () => {
    const cleanup = registerOutcome("remote.fetch", { steps: [], timedOut: true });
    const { setup, fake } = await renderRunner();

    await waitForInitialRead(setup, fake);

    await act(async () => {
      await latestRunner?.runCommand(FETCH_REQUEST);
    });

    expect(latestConsole?.entries[0]?.status).toBe("timed-out");
    expect(latestStatus?.status).toEqual({ kind: "warning", message: "timed out" });
    expect(errorReports).toHaveLength(0);

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("performs no refresh, console append, or error effect for a blocked request", async () => {
    const { setup, fake } = await renderRunner();

    await waitForInitialRead(setup, fake);
    const statusBefore = fake.statusReads();

    await act(async () => {
      await latestRunner?.runCommand({ commandId: "branch.delete", target: { kind: "none" } });
    });

    expect(fake.statusReads()).toBe(statusBefore);
    expect(latestConsole?.entries).toHaveLength(0);
    expect(errorReports).toHaveLength(0);
    expect(latestStatus?.status).toEqual({ kind: "warning", message: "Select an item first" });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("forwards progress to the running operation", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const cleanup = registerCommandHandler({
      commandId: "remote.fetch",
      operationLabel: "Fetch",
      handler: async ({ notifyProgress }) => {
        notifyProgress({ phase: "Receiving objects", percent: 42 });
        await gate;

        return { steps: [okStep()] };
      },
    });
    const { setup, fake } = await renderRunner();

    await waitForInitialRead(setup, fake);

    let running: Promise<unknown> | undefined;

    await act(async () => {
      running = latestRunner?.runCommand(FETCH_REQUEST);
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    expect(latestStatus?.operation?.phase).toBe("Receiving objects");
    expect(latestStatus?.operation?.percent).toBe(42);

    await act(async () => {
      release();
      await running;
    });

    expect(latestStatus?.operation).toBeNull();

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("redacts credentials before the console append", async () => {
    const cleanup = registerOutcome("remote.fetch", {
      steps: [
        okStep({
          argv: ["git", "fetch", "https://user:secret@example.com/repo.git"],
          stderr: "fatal: unable to access https://user:secret@example.com/repo.git",
          exitCode: 128,
        }),
      ],
    });
    const { setup, fake } = await renderRunner();

    await waitForInitialRead(setup, fake);

    await act(async () => {
      await latestRunner?.runCommand(FETCH_REQUEST);
    });

    expect(JSON.stringify(latestConsole?.entries)).not.toContain("secret");
    expect(JSON.stringify(errorReports)).not.toContain("secret");

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("sets an error status with the default sink", async () => {
    const cleanup = registerOutcome("remote.fetch", {
      steps: [okStep({ exitCode: 1, stderr: "fatal: nope" })],
    });
    const { setup, fake } = await renderRunner({ withDefaultSink: true });

    await waitForInitialRead(setup, fake);

    await act(async () => {
      await latestRunner?.runCommand(FETCH_REQUEST);
    });

    expect(latestStatus?.status).toEqual({ kind: "error", message: "fatal: nope" });

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("aborts the current invocation through the exposed handle", async () => {
    const cleanup = registerCommandHandler({
      commandId: "remote.fetch",
      operationLabel: "Fetch",
      handler: async ({ signal }) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });

        return { steps: [], cancelled: true };
      },
    });
    const { setup, fake } = await renderRunner();

    await waitForInitialRead(setup, fake);

    let running: Promise<unknown> | undefined;

    await act(async () => {
      running = latestRunner?.runCommand(FETCH_REQUEST);
      await new Promise((resolve) => setTimeout(resolve, 5));
      await latestRunner?.abort();
    });

    await act(async () => {
      await running;
    });

    expect(latestConsole?.entries[0]?.status).toBe("cancelled");
    expect(latestStatus?.status).toEqual({ kind: "warning", message: "cancelled" });

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("makes app.refresh observable without entering the command runner", async () => {
    const cleanup = registerOutcome("app.refresh", { steps: [okStep()] });
    const { setup, fake } = await renderRunner();

    await waitForInitialRead(setup, fake);
    const statusBefore = fake.statusReads();

    await act(async () => {
      resolveActionHandler("app.refresh", "global")?.();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(handlerCalls).toBe(0);
    expect(fake.statusReads()).toBe(statusBefore + 1);
    expect(latestConsole?.entries).toHaveLength(1);
    expect(latestConsole?.entries[0]?.status).toBe("success");
    expect(latestStatus?.status).toEqual({ kind: "success", message: "Repository refreshed" });

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });
});
