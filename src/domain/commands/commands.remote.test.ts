import { describe, expect, it } from "bun:test";
import { executeRemotePull, executeRemotePush } from "@/domain/commands/commands.remote";
import type {
  CommandFormValues,
  CommandHandlerContext,
  CommandProgress,
  CommandTarget,
} from "@/domain/commands/commands.types";
import type { GitClient, GitInvocationResult, GitInvokeOptions } from "@/domain/git/git.types";

/** Arguments that read the current branch upstream. */
const CURRENT_UPSTREAM_ARGS =
  "for-each-ref --format=%(upstream:remotename)%09%(upstream:remoteref) refs/heads/main";

/** Answer for one git invocation key. */
type Answer = (options: GitInvokeOptions) => GitInvocationResult;

/**
 * Builds an invocation result.
 *
 * @param stdout - Captured output.
 * @param ok - Whether git exited cleanly.
 * @param stderr - Captured error.
 * @returns The synthetic result.
 */
function result(stdout: string = "", ok: boolean = true, stderr: string = ""): GitInvocationResult {
  return {
    argv: ["git"],
    cwd: "/repo",
    exitCode: ok ? 0 : 1,
    terminationSignal: null,
    stdout,
    stderr: ok ? "" : stderr,
    durationMs: 1,
    cancelled: false,
    timedOut: false,
    timedOutAfterMs: null,
    spawnError: null,
    ok,
  };
}

/**
 * Reads the branch name a target would have.
 *
 * @param target - Explicit command target.
 * @returns The branch name, or an empty string for a non-branch target.
 */
function readTargetBranch(target: CommandTarget): string {
  return target.kind === "branch" ? target.name : "";
}

/**
 * Builds a handler context with a fake git client.
 *
 * @param input - Command id, target, per-argument answers, and optional form values.
 * @returns The context plus its recorded calls and progress events.
 */
function createContext(input: {
  readonly commandId: string;
  readonly target: CommandTarget;
  readonly answers: Readonly<Record<string, Answer>>;
  readonly formValues?: CommandFormValues;
}): {
  readonly context: CommandHandlerContext;
  readonly calls: GitInvokeOptions[];
  readonly progress: CommandProgress[];
} {
  const calls: GitInvokeOptions[] = [];
  const progress: CommandProgress[] = [];
  const client: GitClient = {
    gitPath: "git",
    invoke: async (options) => {
      calls.push(options);

      const key = options.args.join(" ");
      const answer =
        input.answers[key] ??
        (key === "branch --show-current"
          ? () => result(`${readTargetBranch(input.target)}\n`)
          : undefined);

      if (answer === undefined) {
        return result("", false, "fatal: unexpected command");
      }

      return { ...answer(options), argv: ["git", ...options.args] };
    },
  };

  return {
    context: {
      request: {
        commandId: input.commandId,
        target: input.target,
        ...(input.formValues === undefined ? {} : { formValues: input.formValues }),
      },
      target: input.target,
      cwd: "/repo",
      client,
      signal: new AbortController().signal,
      notifyProgress: (event) => progress.push(event),
    },
    calls,
    progress,
  };
}

/** Target for a push or pull of the current branch. */
const BRANCH_TARGET: CommandTarget = { kind: "branch", name: "main" };

/** No target, for fetch and fetch-prune. */
const NO_TARGET: CommandTarget = { kind: "none" };

describe("executeRemotePull", () => {
  it("runs git pull with progress on the network class and forwards phases", async () => {
    const { context, calls, progress } = createContext({
      commandId: "remote.pull",
      target: BRANCH_TARGET,
      answers: {
        "pull --progress --no-edit": (options) => {
          options.onStderr?.("Receiving objects: 42%\r\nReceiving objects: 100%\r\n");

          return result("");
        },
      },
    });

    const outcome = await executeRemotePull(context);

    expect(calls[0]?.args).toEqual(["pull", "--progress", "--no-edit"]);
    expect(calls[0]?.operationClass).toBe("network");
    expect(outcome.steps).toHaveLength(1);
    expect(outcome.steps[0]?.argv).toEqual(["git", "pull", "--progress", "--no-edit"]);
    expect(progress).toEqual([
      { phase: "Receiving objects", percent: 42 },
      { phase: "Receiving objects", percent: 100 },
    ]);
  });
});

describe("executeRemotePush", () => {
  /**
   * Runs one push variant against a branch that has an upstream.
   *
   * @param commandId - Push command id.
   * @param pushArgs - Expected argument key.
   * @returns The outcome, recorded calls, and progress.
   */
  async function runWithUpstream(
    commandId: string,
    pushArgs: string,
  ): Promise<{
    outcome: Awaited<ReturnType<typeof executeRemotePush>>;
    calls: GitInvokeOptions[];
    progress: CommandProgress[];
  }> {
    const { context, calls, progress } = createContext({
      commandId,
      target: BRANCH_TARGET,
      answers: {
        [CURRENT_UPSTREAM_ARGS]: () => result("origin\trefs/heads/main\n"),
        remote: () => result("origin\n"),
        [pushArgs]: () => result(""),
      },
    });

    return { outcome: await executeRemotePush(context), calls, progress };
  }

  it("pushes the current branch to its existing upstream", async () => {
    const { outcome, calls } = await runWithUpstream(
      "remote.push",
      "push --progress -- origin refs/heads/main:refs/heads/main",
    );

    expect(outcome.steps[0]?.argv).toEqual([
      "git",
      "push",
      "--progress",
      "--",
      "origin",
      "refs/heads/main:refs/heads/main",
    ]);
    expect(calls.at(-1)?.operationClass).toBe("network");
  });

  it("refuses to push when git's actual branch differs from the captured target", async () => {
    const { context, calls } = createContext({
      commandId: "remote.push",
      target: BRANCH_TARGET,
      answers: {
        "branch --show-current": () => result("other\n"),
        [CURRENT_UPSTREAM_ARGS]: () => result("origin\trefs/heads/main\n"),
      },
    });

    const outcome = await executeRemotePush(context);

    expect(outcome.steps[0]).toMatchObject({
      argv: [],
      exitCode: 1,
      stderr: "fatal: current branch changed; expected main, found other",
    });
    expect(calls.some((call) => call.args[0] === "push")).toBeFalse();
  });

  it("refuses to push from a detached HEAD", async () => {
    const { context, calls } = createContext({
      commandId: "remote.push",
      target: BRANCH_TARGET,
      answers: {
        "branch --show-current": () => result(""),
      },
    });

    const outcome = await executeRemotePush(context);

    expect(outcome.steps[0]?.exitCode).toBe(1);
    expect(outcome.steps[0]?.stderr).toBe(
      "fatal: current branch changed; expected main, found detached",
    );
    expect(calls.some((call) => call.args[0] === "push")).toBeFalse();
  });

  it("treats a truncated or failed current-branch read as a failure", async () => {
    const truncated = createContext({
      commandId: "remote.push",
      target: BRANCH_TARGET,
      answers: {
        "branch --show-current": () => ({ ...result("main\n"), stdoutTruncated: true }),
      },
    });
    const failed = createContext({
      commandId: "remote.push",
      target: BRANCH_TARGET,
      answers: {
        "branch --show-current": () => result("", false, "fatal: cannot read HEAD"),
      },
    });

    const truncatedOutcome = await executeRemotePush(truncated.context);
    const failedOutcome = await executeRemotePush(failed.context);

    expect(truncatedOutcome.steps[0]?.stderr).toContain("truncated");
    expect(failedOutcome.steps[0]?.exitCode).toBe(1);
    expect(truncated.calls.some((call) => call.args[0] === "push")).toBeFalse();
    expect(failed.calls.some((call) => call.args[0] === "push")).toBeFalse();
  });

  it("adds the force flag for the safe and overwrite variants", async () => {
    const safe = await runWithUpstream(
      "remote.pushForceSafe",
      "push --progress --force-with-lease -- origin refs/heads/main:refs/heads/main",
    );
    const overwrite = await runWithUpstream(
      "remote.pushForceOverwrite",
      "push --progress --force -- origin refs/heads/main:refs/heads/main",
    );

    expect(safe.outcome.steps[0]?.argv).toEqual([
      "git",
      "push",
      "--progress",
      "--force-with-lease",
      "--",
      "origin",
      "refs/heads/main:refs/heads/main",
    ]);
    expect(overwrite.outcome.steps[0]?.argv).toEqual([
      "git",
      "push",
      "--progress",
      "--force",
      "--",
      "origin",
      "refs/heads/main:refs/heads/main",
    ]);
  });

  it("adds --no-verify when the branch has an upstream", async () => {
    const { outcome } = await runWithUpstream(
      "remote.pushNoVerify",
      "push --progress --no-verify -- origin refs/heads/main:refs/heads/main",
    );

    expect(outcome.steps[0]?.argv).toEqual([
      "git",
      "push",
      "--progress",
      "--no-verify",
      "--",
      "origin",
      "refs/heads/main:refs/heads/main",
    ]);
  });

  it("creates origin/<branch> and sets the upstream when none exists", async () => {
    const { context } = createContext({
      commandId: "remote.push",
      target: { kind: "branch", name: "feature/AB-1231" },
      answers: {
        "for-each-ref --format=%(upstream:remotename)%09%(upstream:remoteref) refs/heads/feature/AB-1231":
          () => result(""),
        remote: () => result("origin\n"),
        "push --progress --set-upstream origin refs/heads/feature/AB-1231:refs/heads/feature/AB-1231":
          () => result(""),
      },
    });

    const outcome = await executeRemotePush(context);

    expect(outcome.steps[0]?.argv).toEqual([
      "git",
      "push",
      "--progress",
      "--set-upstream",
      "origin",
      "refs/heads/feature/AB-1231:refs/heads/feature/AB-1231",
    ]);
  });

  it("keeps --no-verify on the auto-create path", async () => {
    const { context } = createContext({
      commandId: "remote.pushNoVerify",
      target: { kind: "branch", name: "feature/AB-1231" },
      answers: {
        "for-each-ref --format=%(upstream:remotename)%09%(upstream:remoteref) refs/heads/feature/AB-1231":
          () => result(""),
        remote: () => result("origin\n"),
        "push --progress --no-verify --set-upstream origin refs/heads/feature/AB-1231:refs/heads/feature/AB-1231":
          () => result(""),
      },
    });

    const outcome = await executeRemotePush(context);

    expect(outcome.steps[0]?.argv).toEqual([
      "git",
      "push",
      "--progress",
      "--no-verify",
      "--set-upstream",
      "origin",
      "refs/heads/feature/AB-1231:refs/heads/feature/AB-1231",
    ]);
  });

  it("pushes to a slash-named upstream remote without splitting its name", async () => {
    const { context } = createContext({
      commandId: "remote.push",
      target: { kind: "branch", name: "foo" },
      answers: {
        "for-each-ref --format=%(upstream:remotename)%09%(upstream:remoteref) refs/heads/foo": () =>
          result("a/b\trefs/heads/main\n"),
        "push --progress -- a/b refs/heads/foo:refs/heads/main": () => result(""),
      },
    });

    const outcome = await executeRemotePush(context);

    expect(outcome.steps[0]?.argv).toEqual([
      "git",
      "push",
      "--progress",
      "--",
      "a/b",
      "refs/heads/foo:refs/heads/main",
    ]);
  });

  it("refuses a configured upstream with a missing half", async () => {
    const { context, calls } = createContext({
      commandId: "remote.push",
      target: BRANCH_TARGET,
      answers: {
        [CURRENT_UPSTREAM_ARGS]: () => result("origin\t\n"),
      },
    });

    const outcome = await executeRemotePush(context);

    expect(outcome.steps[0]).toMatchObject({
      argv: [],
      exitCode: 1,
      stderr: 'fatal: could not read the configured upstream of "main"',
    });
    expect(calls.some((call) => call.args[0] === "push")).toBeFalse();
  });

  it("returns a synthetic failure when no origin remote exists", async () => {
    const { context, calls } = createContext({
      commandId: "remote.push",
      target: BRANCH_TARGET,
      answers: {
        [CURRENT_UPSTREAM_ARGS]: () => result(""),
        remote: () => result("upstream\nfork\n"),
      },
    });

    const outcome = await executeRemotePush(context);

    expect(outcome.steps).toHaveLength(1);
    expect(outcome.steps[0]).toMatchObject({
      argv: [],
      exitCode: 1,
      stderr: "No origin remote. Configured remotes: upstream, fork.",
      stdout: "",
      durationMs: 0,
    });
    expect(calls.some((call) => call.args[0] === "push")).toBeFalse();
  });

  it("recreates the configured upstream rather than creating origin/<branch>", async () => {
    const { context, calls } = createContext({
      commandId: "remote.push",
      target: BRANCH_TARGET,
      answers: {
        [CURRENT_UPSTREAM_ARGS]: () => result("origin\trefs/heads/main\n"),
        "push --progress -- origin refs/heads/main:refs/heads/main": () => result(""),
      },
    });

    const outcome = await executeRemotePush(context);

    expect(outcome.steps[0]?.argv).toEqual([
      "git",
      "push",
      "--progress",
      "--",
      "origin",
      "refs/heads/main:refs/heads/main",
    ]);
    expect(calls.some((call) => call.args.includes("--set-upstream"))).toBeFalse();
    expect(calls.some((call) => call.args[0] === "remote")).toBeFalse();
  });

  it("refuses a force push without an upstream before invoking git", async () => {
    const { context, calls } = createContext({
      commandId: "remote.pushForceSafe",
      target: BRANCH_TARGET,
      answers: {
        [CURRENT_UPSTREAM_ARGS]: () => result(""),
        remote: () => result("origin\n"),
      },
    });

    const outcome = await executeRemotePush(context);

    expect(outcome.steps[0]).toMatchObject({
      argv: [],
      exitCode: 1,
      stderr: "no upstream; use Push to create it first.",
    });
    expect(calls.some((call) => call.args[0] === "push")).toBeFalse();
  });

  it("emits a creating phase before an auto-create push", async () => {
    const { context, progress } = createContext({
      commandId: "remote.push",
      target: { kind: "branch", name: "feature/AB-1231" },
      answers: {
        "for-each-ref --format=%(upstream:remotename)%09%(upstream:remoteref) refs/heads/feature/AB-1231":
          () => result(""),
        remote: () => result("origin\n"),
        "push --progress --set-upstream origin refs/heads/feature/AB-1231:refs/heads/feature/AB-1231":
          () => result(""),
      },
    });

    await executeRemotePush(context);

    expect(progress).toEqual([{ phase: "creating origin/feature/AB-1231" }]);
  });

  it("treats a truncated upstream read as a failure and never pushes", async () => {
    const { context, calls } = createContext({
      commandId: "remote.push",
      target: BRANCH_TARGET,
      answers: {
        [CURRENT_UPSTREAM_ARGS]: () => ({
          ...result("origin\trefs/heads/main\n"),
          stdoutTruncated: true,
        }),
      },
    });

    const outcome = await executeRemotePush(context);

    expect(outcome.steps[0]?.exitCode).toBe(1);
    expect(outcome.steps[0]?.stderr).toContain("truncated");
    expect(calls.some((call) => call.args[0] === "push")).toBeFalse();
  });

  it("treats a truncated remote read on the auto-create path as a failure", async () => {
    const { context, calls } = createContext({
      commandId: "remote.push",
      target: BRANCH_TARGET,
      answers: {
        [CURRENT_UPSTREAM_ARGS]: () => result(""),
        remote: () => ({ ...result("origin\n"), stdoutTruncated: true }),
      },
    });

    const outcome = await executeRemotePush(context);

    expect(outcome.steps[0]?.stdoutTruncated).toBeTrue();
    expect(outcome.failed).toBeTrue();
    expect(calls.some((call) => call.args[0] === "push")).toBeFalse();
  });

  it("blocks a command id that is not a push variant", async () => {
    const { context, calls } = createContext({
      commandId: "remote.nope",
      target: NO_TARGET,
      answers: {},
    });

    const outcome = await executeRemotePush(context);

    expect(outcome.blockedReason).toBe("command-not-implemented");
    expect(outcome.steps).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });
});
