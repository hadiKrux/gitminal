import { describe, expect, it } from "bun:test";
import { executeRemoteFetchPrune } from "@/domain/commands/commands.prune";
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
 * Builds a timed-out invocation result.
 *
 * @param stderr - Captured error the client reports on timeout.
 * @returns The synthetic timed-out result.
 */
function timedOutResult(stderr: string = "timed out after 120 seconds"): GitInvocationResult {
  return { ...result("", false, stderr), exitCode: null, timedOut: true, timedOutAfterMs: 120000 };
}

/**
 * Builds a handler context with a fake git client.
 *
 * @param input - Command id, per-argument answers, and optional form values.
 * @returns The context plus its recorded calls and progress events.
 */
function createContext(input: {
  readonly answers: Readonly<Record<string, Answer>>;
  readonly formValues?: CommandFormValues;
}): {
  readonly context: CommandHandlerContext;
  readonly calls: GitInvokeOptions[];
  readonly progress: CommandProgress[];
} {
  const calls: GitInvokeOptions[] = [];
  const progress: CommandProgress[] = [];
  const target: CommandTarget = { kind: "none" };
  const client: GitClient = {
    gitPath: "git",
    invoke: async (options) => {
      calls.push(options);

      const answer = input.answers[options.args.join(" ")];

      if (answer === undefined) {
        return result("", false, "fatal: unexpected command");
      }

      return { ...answer(options), argv: ["git", ...options.args] };
    },
  };

  return {
    context: {
      request: {
        commandId: "remote.fetchPrune",
        target,
        ...(input.formValues === undefined ? {} : { formValues: input.formValues }),
      },
      target,
      cwd: "/repo",
      client,
      signal: new AbortController().signal,
      notifyProgress: (event) => progress.push(event),
    },
    calls,
    progress,
  };
}

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
      answers: { ...answers, [GROUPS_ARGS]: () => result(groups) },
      ...(formValues === undefined ? {} : { formValues }),
    });

    return { outcome: await executeRemoteFetchPrune(context), calls, progress };
  }

  /**
   * Maps recorded calls to their argument keys.
   *
   * @param calls - Recorded invocations.
   * @returns One argument key per invocation.
   */
  function argumentKeys(calls: readonly GitInvokeOptions[]): readonly string[] {
    return calls.map((call) => call.args.join(" "));
  }

  /** Three local branches tracking three origin branches. */
  const THREE_GROUPS = [
    upstreamRow("main", "origin", "main"),
    upstreamRow("feature", "origin", "feature"),
    upstreamRow("topic", "origin", "topic"),
    "",
  ].join("\n");

  it("confirms heads, fetches, prunes the remote, and then deletes the confirmed stale refs", async () => {
    const { outcome, calls } = await runPrune(THREE_GROUPS, {
      "ls-remote --heads -- origin": () =>
        result("aaa\trefs/heads/main\nzzz\trefs/heads/unrelated\n"),
      "fetch --progress -- origin +refs/heads/main:refs/remotes/origin/main": () => result(""),
      "remote prune -- origin": () => result(" * [pruned] origin/gone\n"),
      "update-ref -d -- refs/remotes/origin/feature": () => result(""),
      "update-ref -d -- refs/remotes/origin/topic": () => result(""),
    });
    const keys = argumentKeys(calls);
    const lsIndex = keys.indexOf("ls-remote --heads -- origin");
    const fetchIndex = keys.indexOf(
      "fetch --progress -- origin +refs/heads/main:refs/remotes/origin/main",
    );
    const pruneIndex = keys.indexOf("remote prune -- origin");
    const firstDelete = keys.indexOf("update-ref -d -- refs/remotes/origin/feature");

    expect(lsIndex).toBeGreaterThanOrEqual(0);
    expect(fetchIndex).toBeGreaterThan(lsIndex);
    expect(pruneIndex).toBeGreaterThan(fetchIndex);
    expect(firstDelete).toBeGreaterThan(pruneIndex);
    expect(calls.find((call) => call.args[0] === "ls-remote")?.operationClass).toBe("network");
    expect(
      calls.find((call) => call.args.join(" ") === "remote prune -- origin")?.operationClass,
    ).toBe("network");
    expect(calls.find((call) => call.args[0] === "update-ref")?.operationClass).toBe("write");
    expect(calls.filter((call) => call.args[0] === "update-ref").length).toBe(2);
    expect(outcome.prunedUpstreamRefs).toEqual(["origin/feature", "origin/topic"]);
    expect(outcome.unknownUpstreamRefs).toEqual([]);
    expect(outcome.remoteResults).toEqual([{ remote: "origin", succeeded: true }]);
    expect(outcome.warnings).toEqual(["Fetched 1 upstream; 2 upstreams missing"]);
    expect(keys.some((key) => key.includes("unrelated"))).toBeFalse();
  });

  it("emits a checking phase and a pruning phase for each remote", async () => {
    const { progress } = await runPrune(`${upstreamRow("main", "origin", "main")}\n`, {
      "ls-remote --heads -- origin": () => result("aaa\trefs/heads/main\n"),
      "fetch --progress -- origin +refs/heads/main:refs/remotes/origin/main": () => result(""),
      "remote prune -- origin": () => result(""),
    });

    expect(progress[0]).toEqual({ phase: "checking origin" });
    expect(progress).toContainEqual({ phase: "pruning origin" });
  });

  it("prunes the remote after a clean fetch even when no upstream is missing", async () => {
    const { outcome, calls } = await runPrune(`${upstreamRow("main", "origin", "main")}\n`, {
      "ls-remote --heads -- origin": () => result("aaa\trefs/heads/main\n"),
      "fetch --progress -- origin +refs/heads/main:refs/remotes/origin/main": () => result(""),
      "remote prune -- origin": () => result(" * [pruned] origin/gone\n"),
    });
    const keys = argumentKeys(calls);

    expect(keys).toContain("remote prune -- origin");
    expect(calls.filter((call) => call.args[0] === "update-ref")).toHaveLength(0);
    expect(outcome.prunedUpstreamRefs).toEqual([]);
    expect(outcome.unknownUpstreamRefs).toEqual([]);
    expect(outcome.remoteResults).toEqual([{ remote: "origin", succeeded: true }]);
    expect(outcome.warnings).toEqual(["Fetched 1 upstream"]);
  });

  it("prunes exactly once per remote, in group order, after each fetch", async () => {
    const { outcome, calls } = await runPrune(
      `${upstreamRow("main", "origin", "main")}\n${upstreamRow("upstream-main", "upstream", "main")}\n`,
      {
        "ls-remote --heads -- origin": () => result("aaa\trefs/heads/main\n"),
        "fetch --progress -- origin +refs/heads/main:refs/remotes/origin/main": () => result(""),
        "remote prune -- origin": () => result(""),
        "ls-remote --heads -- upstream": () => result("bbb\trefs/heads/main\n"),
        "fetch --progress -- upstream +refs/heads/main:refs/remotes/upstream/main": () =>
          result(""),
        "remote prune -- upstream": () => result(""),
      },
    );
    const keys = argumentKeys(calls);
    const fetchOrigin = keys.indexOf(
      "fetch --progress -- origin +refs/heads/main:refs/remotes/origin/main",
    );
    const pruneOrigin = keys.indexOf("remote prune -- origin");
    const fetchUpstream = keys.indexOf(
      "fetch --progress -- upstream +refs/heads/main:refs/remotes/upstream/main",
    );
    const pruneUpstream = keys.indexOf("remote prune -- upstream");

    expect(fetchOrigin).toBeGreaterThanOrEqual(0);
    expect(pruneOrigin).toBeGreaterThan(fetchOrigin);
    expect(fetchUpstream).toBeGreaterThan(pruneOrigin);
    expect(pruneUpstream).toBeGreaterThan(fetchUpstream);
    expect(keys.filter((key) => key === "remote prune -- origin")).toHaveLength(1);
    expect(keys.filter((key) => key === "remote prune -- upstream")).toHaveLength(1);
    expect(outcome.remoteResults).toEqual([
      { remote: "origin", succeeded: true },
      { remote: "upstream", succeeded: true },
    ]);
  });

  it("reports a prune failure as a warning without failing the group", async () => {
    const { outcome } = await runPrune(`${upstreamRow("main", "origin", "main")}\n`, {
      "ls-remote --heads -- origin": () => result("aaa\trefs/heads/main\n"),
      "fetch --progress -- origin +refs/heads/main:refs/remotes/origin/main": () => result(""),
      "remote prune -- origin": () => result("", false, "fatal: could not resolve host"),
    });

    expect(outcome.remoteResults).toEqual([{ remote: "origin", succeeded: true }]);
    expect(outcome.prunedUpstreamRefs).toEqual([]);
    expect(outcome.unknownUpstreamRefs).toEqual([]);
    expect(outcome.warnings).toEqual([
      "origin: prune failed; stale refs kept",
      "Fetched 1 upstream",
    ]);
    expect(outcome.failed).toBeUndefined();
  });

  it("reports a prune timeout as a warning without failing or timing out the group", async () => {
    const { outcome } = await runPrune(`${upstreamRow("main", "origin", "main")}\n`, {
      "ls-remote --heads -- origin": () => result("aaa\trefs/heads/main\n"),
      "fetch --progress -- origin +refs/heads/main:refs/remotes/origin/main": () => result(""),
      "remote prune -- origin": () => timedOutResult(),
    });

    expect(outcome.remoteResults).toEqual([{ remote: "origin", succeeded: true }]);
    expect(outcome.prunedUpstreamRefs).toEqual([]);
    expect(outcome.unknownUpstreamRefs).toEqual([]);
    expect(outcome.timedOut).toBeUndefined();
    expect(outcome.failed).toBeUndefined();
    expect(outcome.warnings).toEqual([
      "origin: prune timed out; stale refs kept",
      "Fetched 1 upstream",
    ]);
    expect(outcome.steps.at(-1)).toMatchObject({ exitCode: null, nonFatal: true });
    expect(outcome.steps.at(-1)?.timedOut).toBeTrue();
  });

  it("does not stop fetching other remotes after a prune times out on the first", async () => {
    const { outcome, calls } = await runPrune(
      `${upstreamRow("main", "origin", "main")}\n${upstreamRow("upstream-main", "upstream", "main")}\n`,
      {
        "ls-remote --heads -- origin": () => result("aaa\trefs/heads/main\n"),
        "fetch --progress -- origin +refs/heads/main:refs/remotes/origin/main": () => result(""),
        "remote prune -- origin": () => timedOutResult(),
        "ls-remote --heads -- upstream": () => result("bbb\trefs/heads/main\n"),
        "fetch --progress -- upstream +refs/heads/main:refs/remotes/upstream/main": () =>
          result(""),
        "remote prune -- upstream": () => result(""),
      },
    );
    const keys = argumentKeys(calls);

    expect(keys).toContain("ls-remote --heads -- upstream");
    expect(keys).toContain(
      "fetch --progress -- upstream +refs/heads/main:refs/remotes/upstream/main",
    );
    expect(keys).toContain("remote prune -- upstream");
    expect(outcome.timedOut).toBeUndefined();
    expect(outcome.failed).toBeUndefined();
    expect(outcome.remoteResults).toEqual([
      { remote: "origin", succeeded: true },
      { remote: "upstream", succeeded: true },
    ]);
    expect(outcome.warnings).toEqual([
      "origin: prune timed out; stale refs kept",
      "Fetched 2 upstreams",
    ]);
  });

  it("keeps a failed explicit delete unknown after the prune has already run", async () => {
    const { outcome, calls } = await runPrune(THREE_GROUPS, {
      "ls-remote --heads -- origin": () => result("aaa\trefs/heads/main\n"),
      "fetch --progress -- origin +refs/heads/main:refs/remotes/origin/main": () => result(""),
      "remote prune -- origin": () => result(""),
      "update-ref -d -- refs/remotes/origin/feature": () =>
        result("", false, "fatal: cannot lock ref"),
      "update-ref -d -- refs/remotes/origin/topic": () => result(""),
    });
    const keys = argumentKeys(calls);

    expect(keys.indexOf("remote prune -- origin")).toBeLessThan(
      keys.indexOf("update-ref -d -- refs/remotes/origin/feature"),
    );
    expect(outcome.prunedUpstreamRefs).toEqual(["origin/topic"]);
    expect(outcome.unknownUpstreamRefs).toEqual(["origin/feature"]);
    expect(outcome.remoteResults).toEqual([{ remote: "origin", succeeded: false }]);
    expect(outcome.warnings).toEqual([
      "origin: could not confirm removal of origin/feature",
      "Fetched 1 upstream; 2 upstreams missing; 1 remote failed",
    ]);
    expect(outcome.failed).toBeUndefined();
  });

  it("reports a failed explicit delete as kept locally when the scope skipped the prune", async () => {
    const { outcome, calls } = await runPrune(
      THREE_GROUPS,
      {
        "ls-remote --heads -- origin": () => result(""),
        "update-ref -d -- refs/remotes/origin/main": () =>
          result("", false, "fatal: cannot lock ref"),
      },
      { fetchScope: "current", branch: "main" },
    );
    const keys = argumentKeys(calls);

    expect(keys).not.toContain("remote prune -- origin");
    expect(outcome.prunedUpstreamRefs).toEqual([]);
    expect(outcome.unknownUpstreamRefs).toEqual(["origin/main"]);
    expect(outcome.warnings).toEqual([
      "origin: could not delete origin/main; kept it locally",
      "1 upstream missing; 1 remote failed",
    ]);
    expect(outcome.failed).toBeTrue();
  });

  it("skips the explicit deletes when the prune is cancelled", async () => {
    const cancelled: GitInvocationResult = {
      ...result("", false, "fatal: cancelled"),
      cancelled: true,
      exitCode: null,
    };
    const { outcome, calls } = await runPrune(THREE_GROUPS, {
      "ls-remote --heads -- origin": () => result("aaa\trefs/heads/main\n"),
      "fetch --progress -- origin +refs/heads/main:refs/remotes/origin/main": () => result(""),
      "remote prune -- origin": () => cancelled,
    });

    expect(calls.filter((call) => call.args[0] === "update-ref")).toHaveLength(0);
    expect(outcome.cancelled).toBeTrue();
    expect(outcome.prunedUpstreamRefs).toEqual([]);
    expect(outcome.unknownUpstreamRefs).toEqual(["origin/feature", "origin/topic"]);
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
    expect(calls.filter((call) => call.args[0] === "remote")).toHaveLength(0);
    expect(outcome.prunedUpstreamRefs).toEqual([]);
    expect(outcome.unknownUpstreamRefs).toEqual(["origin/feature", "origin/main", "origin/topic"]);
    expect(outcome.remoteResults).toEqual([{ remote: "origin", succeeded: false }]);
    expect(outcome.failed).toBeTrue();
  });

  it("treats a truncated upstream-scope read as a failed command", async () => {
    const { context, calls } = createContext({
      answers: { [GROUPS_ARGS]: () => ({ ...result(THREE_GROUPS), stdoutTruncated: true }) },
    });

    const outcome = await executeRemoteFetchPrune(context);

    expect(outcome.steps).toHaveLength(1);
    expect(outcome.failed).toBeTrue();
    expect(calls.filter((call) => call.args[0] === "ls-remote")).toHaveLength(0);
    expect(calls.filter((call) => call.args[0] === "update-ref")).toHaveLength(0);
    expect(calls.filter((call) => call.args[0] === "remote")).toHaveLength(0);
    expect(outcome.prunedUpstreamRefs).toBeUndefined();
  });

  it("reports a total group failure as a failed command", async () => {
    const { outcome } = await runPrune(THREE_GROUPS, {
      "ls-remote --heads -- origin": () => result("", false, "fatal: unable to access remote"),
    });

    expect(outcome.failed).toBeTrue();
    expect(outcome.remoteResults).toEqual([{ remote: "origin", succeeded: false }]);
  });

  it("performs no cleanup when the remote check fails", async () => {
    const { outcome, calls } = await runPrune(THREE_GROUPS, {
      "ls-remote --heads -- origin": () => result("", false, "fatal: unable to access remote"),
    });

    expect(calls.filter((call) => call.args[0] === "fetch")).toHaveLength(0);
    expect(calls.filter((call) => call.args[0] === "update-ref")).toHaveLength(0);
    expect(calls.filter((call) => call.args[0] === "remote")).toHaveLength(0);
    expect(outcome.prunedUpstreamRefs).toEqual([]);
    expect(outcome.unknownUpstreamRefs).toEqual(["origin/feature", "origin/main", "origin/topic"]);
    expect(outcome.remoteResults).toEqual([{ remote: "origin", succeeded: false }]);
    expect(outcome.warnings).toEqual([
      "origin: remote check failed; kept 3 upstreams",
      "1 remote failed",
    ]);
    expect(outcome.steps[0]).toMatchObject({ nonFatal: true });
  });

  it("treats unparsable head output as an unknown remote", async () => {
    const { outcome, calls } = await runPrune(THREE_GROUPS, {
      "ls-remote --heads -- origin": () => result("not a head line\n"),
    });

    expect(calls.filter((call) => call.args[0] === "update-ref")).toHaveLength(0);
    expect(calls.filter((call) => call.args[0] === "remote")).toHaveLength(0);
    expect(outcome.unknownUpstreamRefs).toEqual(["origin/feature", "origin/main", "origin/topic"]);
    expect(outcome.warnings?.[0]).toBe("origin: remote check failed; kept 3 upstreams");
  });

  it("skips the cleanup phase when a required fetch fails", async () => {
    const { outcome, calls } = await runPrune(
      `${upstreamRow("main", "origin", "main")}\n${upstreamRow("feature", "origin", "feature")}\n`,
      {
        "ls-remote --heads -- origin": () => result("aaa\trefs/heads/main\n"),
        "fetch --progress -- origin +refs/heads/main:refs/remotes/origin/main": () =>
          result("", false, "fatal: could not resolve host"),
      },
    );

    expect(calls.filter((call) => call.args[0] === "update-ref")).toHaveLength(0);
    expect(calls.filter((call) => call.args[0] === "remote")).toHaveLength(0);
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
    expect(calls.filter((call) => call.args[0] === "remote")).toHaveLength(0);
  });

  it("continues with other remotes when one check fails", async () => {
    const { outcome, calls } = await runPrune(
      `${upstreamRow("main", "origin", "main")}\n${upstreamRow("upstream-main", "upstream", "main")}\n`,
      {
        "ls-remote --heads -- origin": () => result("", false, "fatal: no route to host"),
        "ls-remote --heads -- upstream": () => result("bbb\trefs/heads/main\n"),
        "fetch --progress -- upstream +refs/heads/main:refs/remotes/upstream/main": () =>
          result(""),
        "remote prune -- upstream": () => result(""),
      },
    );
    const keys = argumentKeys(calls);

    expect(keys).toContain("ls-remote --heads -- origin");
    expect(keys).toContain("ls-remote --heads -- upstream");
    expect(keys).toContain("remote prune -- upstream");
    expect(keys).not.toContain("remote prune -- origin");
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

  it("plans fetch, prune, and delete with the exact slash-named remote", async () => {
    const { outcome, calls } = await runPrune(
      `${upstreamRow("main", "a/b", "main")}\n${upstreamRow("feature", "a/b", "feature")}\n`,
      {
        "ls-remote --heads -- a/b": () => result("aaa\trefs/heads/main\n"),
        "fetch --progress -- a/b +refs/heads/main:refs/remotes/a/b/main": () => result(""),
        "remote prune -- a/b": () => result(""),
        "update-ref -d -- refs/remotes/a/b/feature": () => result(""),
      },
    );
    const keys = argumentKeys(calls);

    expect(keys).toContain("ls-remote --heads -- a/b");
    expect(keys).toContain("fetch --progress -- a/b +refs/heads/main:refs/remotes/a/b/main");
    expect(keys).toContain("remote prune -- a/b");
    expect(keys).toContain("update-ref -d -- refs/remotes/a/b/feature");
    expect(keys).not.toContain("ls-remote --heads -- a");
    expect(keys).not.toContain("remote prune -- a");
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
    expect(argumentKeys(calls)).toEqual([GROUPS_ARGS]);
  });

  it("runs the remote-wide prune for the local scope", async () => {
    const { outcome, calls } = await runPrune(
      THREE_GROUPS,
      {
        "ls-remote --heads -- origin": () => result("aaa\trefs/heads/main\n"),
        "fetch --progress -- origin +refs/heads/main:refs/remotes/origin/main": () => result(""),
        "remote prune -- origin": () => result(""),
        "update-ref -d -- refs/remotes/origin/feature": () => result(""),
        "update-ref -d -- refs/remotes/origin/topic": () => result(""),
      },
      { fetchScope: "local", branch: "main" },
    );
    const keys = argumentKeys(calls);

    expect(keys).toContain("remote prune -- origin");
    expect(outcome.prunedUpstreamRefs).toEqual(["origin/feature", "origin/topic"]);
    expect(outcome.remoteResults).toEqual([{ remote: "origin", succeeded: true }]);
  });

  it("scopes the fetch to the checked-out branch upstream and never prunes under current", async () => {
    const { outcome, calls } = await runPrune(
      THREE_GROUPS,
      {
        "ls-remote --heads -- origin": () => result("aaa\trefs/heads/main\n"),
        "fetch --progress -- origin +refs/heads/main:refs/remotes/origin/main": () => result(""),
      },
      { fetchScope: "current", branch: "main" },
    );
    const keys = argumentKeys(calls);

    expect(outcome.steps.length).toBeGreaterThan(0);
    expect(keys).not.toContain("remote prune -- origin");
    expect(keys).not.toContain("update-ref -d -- refs/remotes/origin/feature");
    expect(keys).not.toContain("update-ref -d -- refs/remotes/origin/topic");
    expect(outcome.prunedUpstreamRefs).toEqual([]);
    expect(outcome.remoteResults).toEqual([{ remote: "origin", succeeded: true }]);
  });
});
