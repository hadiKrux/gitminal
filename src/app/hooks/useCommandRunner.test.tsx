import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { createRetryHandler } from "@/app/hooks/commandRunner.report";
import {
  isCommandOrchestrationActive,
  recordCommandExecution,
  resetCommandOrchestration,
} from "@/app/hooks/commandRunner.state";
import { resolveActionHandler } from "@/app/hooks/useAction";
import { useCommandRunner } from "@/app/hooks/useCommandRunner";
import type { CommandFailureReport, CommandRunnerHook } from "@/app/hooks/useCommandRunner.types";
import { useConsoleLog } from "@/app/hooks/useConsoleLog";
import { useOverlay } from "@/app/hooks/useOverlay";
import { useRepository, useRepositoryRefreshAction } from "@/app/hooks/useRepository";
import { useStatus } from "@/app/hooks/useStatus";
import { ConfigProvider } from "@/app/providers/ConfigProvider";
import { ConsoleProvider } from "@/app/providers/ConsoleProvider";
import type { ConsoleContextValue } from "@/app/providers/ConsoleProvider.types";
import { FocusProvider } from "@/app/providers/FocusProvider";
import { OverlayProvider } from "@/app/providers/OverlayProvider";
import type { OverlayContextValue } from "@/app/providers/OverlayProvider.types";
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
import { EMPTY_REF_READ_ANSWERS } from "@/test/git.fake";

/** Latest runner handle captured by the probe. */
let latestRunner: CommandRunnerHook | undefined;

/** Latest status context captured by the probe. */
let latestStatus: StatusContextValue | undefined;

/** Latest console context captured by the probe. */
let latestConsole: ConsoleContextValue | undefined;

/** Latest overlay context captured by the probe. */
let latestOverlay: OverlayContextValue | undefined;

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
    "for-each-ref --format=%(upstream:remotename)%09%(upstream:remoteref) refs/heads/main": () =>
      result("origin\trefs/heads/main\n"),
    "for-each-ref --format=%(upstream:short) refs/heads": () => result("origin/main\n"),
    "rev-parse --verify --quiet refs/remotes/origin/main": () => result("abc123\n"),
    ...EMPTY_REF_READ_ANSWERS,
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
  latestOverlay = useOverlay();
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
async function renderRunner(
  options: { withDefaultSink?: boolean; wrapClient?: (client: GitClient) => GitClient } = {},
): Promise<{
  setup: Awaited<ReturnType<typeof testRender>>;
  fake: ReturnType<typeof createFakeGit>;
}> {
  latestRunner = undefined;
  latestStatus = undefined;
  latestConsole = undefined;
  latestOverlay = undefined;
  errorReports = [];
  handlerCalls = 0;

  const fake = createFakeGit();
  const client = options.wrapClient === undefined ? fake.client : options.wrapClient(fake.client);
  let setup: Awaited<ReturnType<typeof testRender>> | undefined;

  await act(async () => {
    setup = await testRender(
      <ConfigProvider>
        <RepositoryProvider
          cwd="/repo"
          gitClient={client}
          createWatcher={NOOP_WATCHER}
          enableWatcher={false}
          now={() => 0}
        >
          <FocusProvider>
            <OverlayProvider>
              <StatusProvider>
                <ConsoleProvider>
                  <RunnerProbe withDefaultSink={options.withDefaultSink} />
                </ConsoleProvider>
              </StatusProvider>
            </OverlayProvider>
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

/**
 * Waits until the console probe has at least the requested number of entries.
 *
 * @param setup - Renderer setup.
 * @param count - Minimum entry count.
 * @returns A promise resolved after the count is reached or the deadline expires.
 */
async function waitForConsoleEntries(
  setup: Awaited<ReturnType<typeof testRender>>,
  count: number,
): Promise<void> {
  const deadline = Date.now() + 2_000;

  while ((latestConsole?.entries.length ?? 0) < count && Date.now() < deadline) {
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
  resetCommandOrchestration();
  errorReports = [];
  handlerCalls = 0;
});

afterEach(() => {
  resetCommandRunner();
  resetCommandOrchestration();
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
    expect(latestOverlay?.entry).toBeNull();
    expect(latestOverlay?.errorDetail).toBeNull();
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

  it("closes only the overlay entry that was open when the command started", async () => {
    const cleanup = registerOutcome("remote.fetch", { steps: [okStep()] });
    const { setup, fake } = await renderRunner();

    await waitForInitialRead(setup, fake);

    await act(async () => {
      latestOverlay?.confirm({
        title: "Clear console",
        description: "Clear the session history.",
        confirmLabel: "Clear console",
        destructive: false,
        onConfirm: () => {},
      });
    });

    const originatingId = latestOverlay?.entry?.id;

    await act(async () => {
      await latestRunner?.runCommand(FETCH_REQUEST);
    });

    expect(originatingId).toBeDefined();
    expect(latestOverlay?.entry).toBeNull();

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("leaves an unrelated overlay open when a command settles", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const cleanup = registerCommandHandler({
      commandId: "remote.fetch",
      operationLabel: "Fetch",
      handler: async () => {
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

    await act(async () => {
      latestOverlay?.confirm({
        title: "Clear console",
        description: "Clear the session history.",
        confirmLabel: "Clear console",
        destructive: false,
        onConfirm: () => {},
      });
    });

    const unrelatedId = latestOverlay?.entry?.id;

    await act(async () => {
      release();
      await running;
    });

    expect(unrelatedId).toBeDefined();
    expect(latestOverlay?.entry?.id).toBe(unrelatedId);

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
      warnings: ["upstream not found for origin/feature"],
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
      message: "upstream not found for origin/feature",
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

  it("treats a timed-out result as a warning with the reported duration, never success", async () => {
    const cleanup = registerOutcome("remote.fetch", {
      steps: [okStep({ exitCode: null, timedOut: true, timedOutAfterMs: 120_000 })],
      timedOut: true,
    });
    const { setup, fake } = await renderRunner();

    await waitForInitialRead(setup, fake);

    await act(async () => {
      await latestRunner?.runCommand(FETCH_REQUEST);
    });

    expect(latestConsole?.entries[0]?.status).toBe("timed-out");
    expect(latestStatus?.status).toEqual({
      kind: "warning",
      message: "timed out after 120 seconds",
    });
    expect(errorReports).toHaveLength(0);

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("blocks a second command while the first refresh is still in flight", async () => {
    const cleanup = registerOutcome("remote.fetch", { steps: [okStep()] });
    let releaseRefresh: () => void = () => {};
    let holding = false;
    let statusReads = 0;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const { setup, fake } = await renderRunner({
      wrapClient: (client) => ({
        gitPath: client.gitPath,
        invoke: async (options) => {
          if (options.args[0] === "status") {
            statusReads += 1;

            if (statusReads >= 2) {
              holding = true;
              await refreshGate;
            }
          }

          return await client.invoke(options);
        },
      }),
    });

    await waitForInitialRead(setup, fake);

    let first: Promise<unknown> | undefined;

    await act(async () => {
      first = latestRunner?.runCommand(FETCH_REQUEST);
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    const deadline = Date.now() + 2_000;

    while (!holding && Date.now() < deadline) {
      await act(async () => {
        await setup.renderOnce();
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
    }

    expect(holding).toBeTrue();
    expect(latestStatus?.operation?.label).toBe("Fetch");

    let second: Awaited<ReturnType<CommandRunnerHook["runCommand"]>> | undefined;

    await act(async () => {
      second = await latestRunner?.runCommand(FETCH_REQUEST);
    });

    expect(second?.status).toBe("blocked");
    expect(second?.blockedReason).toBe("operation-in-progress");
    expect(handlerCalls).toBe(1);
    expect(latestStatus?.operation?.label).toBe("Fetch");

    await act(async () => {
      releaseRefresh();
      await first;
    });

    expect(latestStatus?.operation).toBeNull();

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("resets a stale orchestration slot so a new command can start", async () => {
    const cleanup = registerOutcome("remote.fetch", { steps: [okStep()] });
    const { setup, fake } = await renderRunner();

    await waitForInitialRead(setup, fake);

    recordCommandExecution(new AbortController(), new Promise<never>(() => {}));
    expect(isCommandOrchestrationActive()).toBeTrue();

    resetCommandOrchestration();
    expect(isCommandOrchestrationActive()).toBeFalse();

    let outcome: Awaited<ReturnType<CommandRunnerHook["runCommand"]>> | undefined;

    await act(async () => {
      outcome = await latestRunner?.runCommand(FETCH_REQUEST);
    });

    expect(outcome?.status).toBe("success");
    expect(handlerCalls).toBe(1);

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

  it("opens the persistent error overlay with the default sink", async () => {
    const cleanup = registerOutcome("remote.fetch", {
      steps: [okStep({ exitCode: 1, stderr: "fatal: nope" })],
    });
    const { setup, fake } = await renderRunner({ withDefaultSink: true });

    await waitForInitialRead(setup, fake);

    await act(async () => {
      await latestRunner?.runCommand(FETCH_REQUEST);
    });

    expect(latestStatus?.status).toBeNull();
    expect(latestOverlay?.errorDetail?.commandId).toBe("remote.fetch");
    expect(latestOverlay?.errorDetail?.message).toBe("fatal: nope");
    expect(latestOverlay?.errorDetail?.details).toContain("fatal: nope");
    expect(latestOverlay?.errorDetail?.consoleEntryId).toBe(latestConsole?.entries[0]?.id ?? null);
    expect(latestOverlay?.errorDetail?.retry).toBeFunction();

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("re-runs the original request when the error overlay retries", async () => {
    const requests: CommandRequest[] = [];
    const cleanup = registerCommandHandler({
      commandId: "remote.fetch",
      operationLabel: "Fetch",
      handler: async ({ request }) => {
        requests.push(request);

        return requests.length === 1
          ? { steps: [okStep({ exitCode: 1, stderr: "fatal: network down" })] }
          : { steps: [okStep()] };
      },
    });
    const { setup, fake } = await renderRunner({ withDefaultSink: true });

    await waitForInitialRead(setup, fake);

    await act(async () => {
      await latestRunner?.runCommand({
        ...FETCH_REQUEST,
        formValues: { branch: "main" },
      });
    });

    expect(latestOverlay?.errorDetail?.retry).toBeFunction();

    await act(async () => {
      latestOverlay?.errorDetail?.retry?.();
    });

    const deadline = Date.now() + 2_000;

    while (requests.length < 2 && Date.now() < deadline) {
      await act(async () => {
        await setup.renderOnce();
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
    }

    expect(requests).toHaveLength(2);
    expect(requests[1]?.formValues).toEqual({ branch: "main" });
    expect(latestConsole?.entries).toHaveLength(2);

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("redacts and sanitizes a thrown error before it reaches the error detail", async () => {
    const cleanup = registerCommandHandler({
      commandId: "remote.fetch",
      operationLabel: "Fetch",
      handler: async () => {
        throw new Error(
          "fatal: unable to access https://user:secret@example.com/repo.git\u001b[31m\rboom",
        );
      },
    });
    const { setup, fake } = await renderRunner({ withDefaultSink: true });

    await waitForInitialRead(setup, fake);

    await act(async () => {
      await latestRunner?.runCommand(FETCH_REQUEST).catch(() => {});
    });

    const detail = latestOverlay?.errorDetail;

    expect(detail?.message).toContain("[redacted]");
    expect(detail?.details).toContain("[redacted]");
    expect(detail?.message).not.toContain("secret");
    expect(detail?.details).not.toContain("secret");
    expect(detail?.details).not.toContain("\u001b");
    expect(detail?.details).not.toContain("\r");

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("links a thrown error to exactly one console entry", async () => {
    const cleanup = registerCommandHandler({
      commandId: "remote.fetch",
      operationLabel: "Fetch",
      handler: async () => {
        throw new Error("fatal: handler exploded");
      },
    });
    const { setup, fake } = await renderRunner({ withDefaultSink: true });

    await waitForInitialRead(setup, fake);

    await act(async () => {
      await latestRunner?.runCommand(FETCH_REQUEST).catch(() => {});
    });

    expect(latestConsole?.entries).toHaveLength(1);
    expect(latestConsole?.entries[0]?.status).toBe("failure");
    expect(latestOverlay?.errorDetail?.consoleEntryId).toBe(latestConsole?.entries[0]?.id ?? null);

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("redacts credentials in the settled failure details", async () => {
    const cleanup = registerOutcome("remote.fetch", {
      steps: [
        okStep({
          exitCode: 128,
          stderr: "fatal: unable to access https://user:secret@example.com/repo.git",
        }),
      ],
    });
    const { setup, fake } = await renderRunner({ withDefaultSink: true });

    await waitForInitialRead(setup, fake);

    await act(async () => {
      await latestRunner?.runCommand(FETCH_REQUEST);
    });

    const details = latestOverlay?.errorDetail?.details ?? "";

    expect(details).toContain("[redacted]");
    expect(details).not.toContain("secret");
    expect(latestOverlay?.errorDetail?.consoleEntryId).toBe(latestConsole?.entries[0]?.id ?? null);

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("reuses the appended entry when the post-result refresh rejects", async () => {
    const cleanup = registerOutcome("remote.fetch", { steps: [okStep()] });
    let rejectRefresh = false;
    const { setup, fake } = await renderRunner({
      withDefaultSink: true,
      wrapClient: (client) => ({
        gitPath: client.gitPath,
        invoke: async (options) => {
          if (rejectRefresh && options.args[0] === "status") {
            throw new Error("refresh exploded");
          }

          return await client.invoke(options);
        },
      }),
    });

    await waitForInitialRead(setup, fake);
    rejectRefresh = true;

    await act(async () => {
      await latestRunner?.runCommand(FETCH_REQUEST).catch(() => {});
    });

    const [entry] = latestConsole?.entries ?? [];

    expect(latestConsole?.entries).toHaveLength(1);
    expect(entry).toMatchObject({
      status: "failure",
      operationLabel: "Refresh after Fetch",
      summary: "refresh exploded",
      decisiveError: "refresh exploded",
    });
    expect(latestOverlay?.errorDetail).toMatchObject({
      operationLabel: "Refresh after Fetch",
      message: "refresh exploded",
      consoleEntryId: entry?.id,
    });

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the error overlay when a retry refresh rejects", async () => {
    const requests: CommandRequest[] = [];
    const cleanup = registerCommandHandler({
      commandId: "remote.fetch",
      operationLabel: "Fetch",
      handler: async ({ request }) => {
        requests.push(request);

        return requests.length === 1
          ? { steps: [okStep({ exitCode: 1, stderr: "fatal: network down" })] }
          : { steps: [okStep()] };
      },
    });
    let rejectRefresh = false;
    const { setup, fake } = await renderRunner({
      withDefaultSink: true,
      wrapClient: (client) => ({
        gitPath: client.gitPath,
        invoke: async (options) => {
          if (rejectRefresh && options.args[0] === "status") {
            throw new Error("refresh exploded");
          }

          return await client.invoke(options);
        },
      }),
    });

    await waitForInitialRead(setup, fake);

    await act(async () => {
      await latestRunner?.runCommand(FETCH_REQUEST);
    });

    rejectRefresh = true;

    await act(async () => {
      latestOverlay?.errorDetail?.retry?.();
    });
    await waitForConsoleEntries(setup, 2);

    expect(requests).toHaveLength(2);
    expect(latestConsole?.entries).toHaveLength(2);
    expect(latestOverlay?.errorDetail?.message).toContain("refresh exploded");
    expect(latestOverlay?.errorDetail?.consoleEntryId).toBe(latestConsole?.entries[1]?.id ?? null);

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it.each([
    ["remote.fetch", true],
    ["remote.fetchPrune", true],
    ["remote.pull", true],
    ["remote.push", true],
    ["remote.pushNoVerify", true],
    ["remote.pushForceSafe", false],
    ["remote.pushForceOverwrite", false],
    ["branch.delete", false],
    ["diff.discard", false],
    ["stash.pop", false],
  ])("offers retry only for a safe remote command: %s", (commandId, retryable) => {
    const retry = createRetryHandler({ commandId, target: { kind: "none" } }, { current: null });

    if (retryable) {
      expect(retry).toBeFunction();
      return;
    }

    expect(retry).toBeUndefined();
  });

  it("consumes a rejected retry instead of leaving an unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    const retry = createRetryHandler(FETCH_REQUEST, {
      current: async () => {
        throw new Error("refresh exploded");
      },
    });

    process.on("unhandledRejection", onUnhandled);

    try {
      retry?.();
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }

    expect(retry).toBeFunction();
    expect(unhandled).toHaveLength(0);
  });

  it("caps the error detail and marks the omitted middle", async () => {
    const stderr = Array.from({ length: 120 }, (_, index) => `line ${index}`).join("\n");
    const cleanup = registerOutcome("remote.fetch", {
      steps: [okStep({ exitCode: 1, stderr })],
    });
    const { setup, fake } = await renderRunner({ withDefaultSink: true });

    await waitForInitialRead(setup, fake);

    await act(async () => {
      await latestRunner?.runCommand(FETCH_REQUEST);
    });

    const details = latestOverlay?.errorDetail?.details ?? "";

    expect(details).toContain("lines omitted");
    expect(details).toContain("line 0");
    expect(details).toContain("line 119");

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
