import { describe, expect, it } from "bun:test";
import {
  executeRemoteFetchPrune,
  executeRemotePull,
  executeRemotePush,
} from "@/domain/commands/commands.remote";
import type {
  CommandFormValues,
  CommandHandlerContext,
  CommandProgress,
  CommandTarget,
} from "@/domain/commands/commands.types";
import type { GitClient, GitInvocationResult, GitInvokeOptions } from "@/domain/git/git.types";

/** Arguments that list every local branch upstream. */
const GROUPS_ARGS =
  "for-each-ref --format=%(refname:short)%09%(upstream:remotename)%09%(upstream:remoteref) refs/heads";

/** Arguments that read the current branch upstream. */
const CURRENT_UPSTREAM_ARGS =
  "for-each-ref --format=%(upstream:remotename)%09%(upstream:remoteref) refs/heads/main";

/**
 * Builds one tab-separated upstream row.
 *
 * @param local - Local branch name.
 * @param remote - Upstream remote name.
 * @param branch - Branch inside that remote.
 * @returns The captured row.
 */
function upstreamRow(local: string, remote: string, branch: string): string {
  return `${local}\t${remote}\trefs/heads/${branch}`;
}

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

describe("executeRemoteFetchPrune", () => {
  /**
   * Runs a prune with a group probe and per-argument answers.
   *
   * @param groups - Captured group output.
   * @param answers - Additional answers besides the group probe.
   * @param formValues - Optional request form values carrying the fetch scope and branch.
   * @returns The outcome, calls, and progress.
   */
  async function runPrune(
    groups: string,
    answers: Readonly<Record<string, Answer>>,
    formValues?: CommandFormValues,
  ): Promise<{
    outcome: Awaited<ReturnType<typeof executeRemoteFetchPrune>>;
    calls: GitInvokeOptions[];
    progress: CommandProgress[];
  }> {
    const { context, calls, progress } = createContext({
      commandId: "remote.fetchPrune",
      target: NO_TARGET,
      answers: { ...answers, [GROUPS_ARGS]: () => result(groups) },
      ...(formValues === undefined ? {} : { formValues }),
    });

    return { outcome: await executeRemoteFetchPrune(context), calls, progress };
  }

  /** Three local branches tracking three origin branches. */
  const THREE_GROUPS = [
    upstreamRow("main", "origin", "main"),
    upstreamRow("feature", "origin", "feature"),
    upstreamRow("topic", "origin", "topic"),
    "",
  ].join("\n");

  it("confirms heads before fetching and deletes only confirmed stale in-scope refs", async () => {
    const { outcome, calls } = await runPrune(THREE_GROUPS, {
      "ls-remote --heads -- origin": () =>
        result("aaa\trefs/heads/main\nzzz\trefs/heads/unrelated\n"),
      "fetch --progress -- origin +refs/heads/main:refs/remotes/origin/main": () => result(""),
      "update-ref -d -- refs/remotes/origin/feature": () => result(""),
      "update-ref -d -- refs/remotes/origin/topic": () => result(""),
    });
    const keys = calls.map((call) => call.args.join(" "));
    const lsIndex = keys.indexOf("ls-remote --heads -- origin");
    const fetchIndex = keys.indexOf(
      "fetch --progress -- origin +refs/heads/main:refs/remotes/origin/main",
    );
    const firstDelete = keys.indexOf("update-ref -d -- refs/remotes/origin/feature");

    expect(lsIndex).toBeGreaterThanOrEqual(0);
    expect(fetchIndex).toBeGreaterThan(lsIndex);
    expect(firstDelete).toBeGreaterThan(fetchIndex);
    expect(calls.find((call) => call.args[0] === "ls-remote")?.operationClass).toBe("network");
    expect(calls.filter((call) => call.args[0] === "update-ref").length).toBe(2);
    expect(outcome.prunedUpstreamRefs).toEqual(["origin/feature", "origin/topic"]);
    expect(outcome.unknownUpstreamRefs).toEqual([]);
    expect(outcome.remoteResults).toEqual([{ remote: "origin", succeeded: true }]);
    expect(outcome.warnings).toEqual(["Fetched 1 upstream; 2 upstreams missing"]);
    expect(keys.some((key) => key.includes("unrelated"))).toBeFalse();
  });

  it("emits a checking phase before each remote check", async () => {
    const { progress } = await runPrune(THREE_GROUPS, {
      "ls-remote --heads -- origin": () => result("aaa\trefs/heads/main\n"),
      "fetch --progress -- origin +refs/heads/main:refs/remotes/origin/main": () => result(""),
      "update-ref -d -- refs/remotes/origin/feature": () => result(""),
      "update-ref -d -- refs/remotes/origin/topic": () => result(""),
    });

    expect(progress[0]).toEqual({ phase: "checking origin" });
  });

  it("treats a truncated ls-remote as unknown and deletes nothing", async () => {
    const { outcome, calls } = await runPrune(THREE_GROUPS, {
      "ls-remote --heads -- origin": () => ({
        ...result("aaa\trefs/heads/main\n\n[output truncated]\nzzz\trefs/heads/other\n"),
        stdoutTruncated: true,
      }),
    });

    expect(calls.filter((call) => call.args[0] === "fetch")).toHaveLength(0);
    expect(calls.filter((call) => call.args[0] === "update-ref")).toHaveLength(0);
    expect(outcome.prunedUpstreamRefs).toEqual([]);
    expect(outcome.unknownUpstreamRefs).toEqual(["origin/feature", "origin/main", "origin/topic"]);
    expect(outcome.remoteResults).toEqual([{ remote: "origin", succeeded: false }]);
    expect(outcome.failed).toBeTrue();
  });

  it("treats a truncated upstream-scope read as a failed command", async () => {
    const { context, calls } = createContext({
      commandId: "remote.fetchPrune",
      target: NO_TARGET,
      answers: {
        [GROUPS_ARGS]: () => ({ ...result(THREE_GROUPS), stdoutTruncated: true }),
      },
    });

    const outcome = await executeRemoteFetchPrune(context);

    expect(outcome.steps).toHaveLength(1);
    expect(outcome.failed).toBeTrue();
    expect(calls.filter((call) => call.args[0] === "ls-remote")).toHaveLength(0);
    expect(calls.filter((call) => call.args[0] === "update-ref")).toHaveLength(0);
    expect(outcome.prunedUpstreamRefs).toBeUndefined();
  });

  it("reports a total group failure as a failed command", async () => {
    const { outcome } = await runPrune(THREE_GROUPS, {
      "ls-remote --heads -- origin": () => result("", false, "fatal: unable to access remote"),
    });

    expect(outcome.failed).toBeTrue();
    expect(outcome.remoteResults).toEqual([{ remote: "origin", succeeded: false }]);
  });

  it("performs no deletes when the remote check fails", async () => {
    const { outcome, calls } = await runPrune(THREE_GROUPS, {
      "ls-remote --heads -- origin": () => result("", false, "fatal: unable to access remote"),
    });

    expect(calls.filter((call) => call.args[0] === "fetch")).toHaveLength(0);
    expect(calls.filter((call) => call.args[0] === "update-ref")).toHaveLength(0);
    expect(outcome.prunedUpstreamRefs).toEqual([]);
    expect(outcome.unknownUpstreamRefs).toEqual(["origin/feature", "origin/main", "origin/topic"]);
    expect(outcome.remoteResults).toEqual([{ remote: "origin", succeeded: false }]);
    expect(outcome.warnings).toEqual([
      "origin: remote check failed; kept 3 upstreams",
      "1 remote failed",
    ]);
    expect(outcome.steps[0]?.nonFatal).toBeTrue();
  });

  it("treats unparsable head output as an unknown remote", async () => {
    const { outcome, calls } = await runPrune(THREE_GROUPS, {
      "ls-remote --heads -- origin": () => result("not a head line\n"),
    });

    expect(calls.filter((call) => call.args[0] === "update-ref")).toHaveLength(0);
    expect(outcome.unknownUpstreamRefs).toEqual(["origin/feature", "origin/main", "origin/topic"]);
    expect(outcome.warnings?.[0]).toBe("origin: remote check failed; kept 3 upstreams");
  });

  it("skips the delete phase when a required fetch fails", async () => {
    const { outcome, calls } = await runPrune(
      `${upstreamRow("main", "origin", "main")}\n${upstreamRow("feature", "origin", "feature")}\n`,
      {
        "ls-remote --heads -- origin": () => result("aaa\trefs/heads/main\n"),
        "fetch --progress -- origin +refs/heads/main:refs/remotes/origin/main": () =>
          result("", false, "fatal: could not resolve host"),
      },
    );

    expect(calls.filter((call) => call.args[0] === "update-ref")).toHaveLength(0);
    expect(outcome.prunedUpstreamRefs).toEqual([]);
    expect(outcome.unknownUpstreamRefs).toEqual(["origin/feature", "origin/main"]);
    expect(outcome.remoteResults).toEqual([{ remote: "origin", succeeded: false }]);
    expect(outcome.warnings).toEqual([
      "origin: fetch failed; kept 2 upstreams",
      "1 upstream missing; 1 remote failed",
    ]);
  });

  it("reports cancellation without deleting anything", async () => {
    const cancelled: GitInvocationResult = {
      ...result("", false, "fatal: cancelled"),
      cancelled: true,
      exitCode: null,
    };
    const { outcome, calls } = await runPrune(THREE_GROUPS, {
      "ls-remote --heads -- origin": () => cancelled,
    });

    expect(outcome.cancelled).toBeTrue();
    expect(outcome.prunedUpstreamRefs).toEqual([]);
    expect(calls.filter((call) => call.args[0] === "update-ref")).toHaveLength(0);
  });

  it("continues with other remotes when one check fails", async () => {
    const { outcome, calls } = await runPrune(
      `${upstreamRow("main", "origin", "main")}\n${upstreamRow("upstream-main", "upstream", "main")}\n`,
      {
        "ls-remote --heads -- origin": () => result("", false, "fatal: no route to host"),
        "ls-remote --heads -- upstream": () => result("bbb\trefs/heads/main\n"),
        "fetch --progress -- upstream +refs/heads/main:refs/remotes/upstream/main": () =>
          result(""),
      },
    );
    const keys = calls.map((call) => call.args.join(" "));

    expect(keys).toContain("ls-remote --heads -- origin");
    expect(keys).toContain("ls-remote --heads -- upstream");
    expect(outcome.remoteResults).toEqual([
      { remote: "origin", succeeded: false },
      { remote: "upstream", succeeded: true },
    ]);
    expect(outcome.prunedUpstreamRefs).toEqual([]);
    expect(outcome.unknownUpstreamRefs).toEqual(["origin/main"]);
    expect(outcome.warnings).toEqual([
      "origin: remote check failed; kept 1 upstream",
      "Fetched 1 upstream; 1 remote failed",
    ]);
    expect(outcome.failed).toBeUndefined();
  });

  it("plans fetch and delete with the exact slash-named remote", async () => {
    const { outcome, calls } = await runPrune(
      `${upstreamRow("main", "a/b", "main")}\n${upstreamRow("feature", "a/b", "feature")}\n`,
      {
        "ls-remote --heads -- a/b": () => result("aaa\trefs/heads/main\n"),
        "fetch --progress -- a/b +refs/heads/main:refs/remotes/a/b/main": () => result(""),
        "update-ref -d -- refs/remotes/a/b/feature": () => result(""),
      },
    );
    const keys = calls.map((call) => call.args.join(" "));

    expect(keys).toContain("ls-remote --heads -- a/b");
    expect(keys).toContain("fetch --progress -- a/b +refs/heads/main:refs/remotes/a/b/main");
    expect(keys).toContain("update-ref -d -- refs/remotes/a/b/feature");
    expect(keys).not.toContain("ls-remote --heads -- a");
    expect(outcome.prunedUpstreamRefs).toEqual(["a/b/feature"]);
    expect(outcome.unknownUpstreamRefs).toEqual([]);
    expect(outcome.remoteResults).toEqual([{ remote: "a/b", succeeded: true }]);
  });

  it("blocks a scope with no local upstreams", async () => {
    const { outcome, calls } = await runPrune("", {});

    expect(outcome.blockedReason).toBe("no-local-upstreams");
    expect(outcome.steps).toHaveLength(0);
    expect(calls).toHaveLength(1);
  });

  it("blocks the current scope when its branch has no upstream", async () => {
    const { outcome, calls } = await runPrune(
      THREE_GROUPS,
      {},
      { fetchScope: "current", branch: "missing" },
    );

    expect(outcome.blockedReason).toBe("no-current-upstream");
    expect(outcome.steps).toHaveLength(0);
    expect(calls.map((call) => call.args.join(" "))).toEqual([GROUPS_ARGS]);
  });

  it("scopes the prune read to the checked-out branch upstream", async () => {
    const { outcome, calls } = await runPrune(
      THREE_GROUPS,
      {
        "ls-remote --heads -- origin": () => result("aaa\trefs/heads/main\n"),
        "fetch --progress -- origin +refs/heads/main:refs/remotes/origin/main": () => result(""),
      },
      { fetchScope: "current", branch: "main" },
    );
    const keys = calls.map((call) => call.args.join(" "));

    expect(outcome.steps.length).toBeGreaterThan(0);
    expect(keys).not.toContain("update-ref -d -- refs/remotes/origin/feature");
    expect(keys).not.toContain("update-ref -d -- refs/remotes/origin/topic");
  });
});
