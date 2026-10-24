import { describe, expect, it } from "bun:test";
import { executeRemoteFetch } from "@/domain/commands/commands.fetch";
import type { CommandHandlerContext, CommandProgress } from "@/domain/commands/commands.types";
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

/**
 * Builds an invocation result.
 *
 * @param stdout - Captured output.
 * @param ok - Whether git exited cleanly.
 * @param stderr - Captured error.
 * @returns The synthetic result.
 */
function result(stdout: string, ok: boolean = true, stderr: string = ""): GitInvocationResult {
  return {
    argv: ["git"],
    cwd: "/repo",
    exitCode: ok ? 0 : 1,
    terminationSignal: null,
    stdout,
    stderr,
    durationMs: 1,
    cancelled: false,
    timedOut: false,
    timedOutAfterMs: null,
    spawnError: null,
    ok,
  };
}

/**
 * Builds a handler context that records fetch invocations.
 *
 * @param answers - Per-command answers.
 * @param progress - Progress accumulator.
 * @param calls - Invocation accumulator.
 * @returns The handler context.
 */
function createContext(
  answers: Readonly<Record<string, (options: GitInvokeOptions) => GitInvocationResult>>,
  progress: CommandProgress[],
  calls: GitInvokeOptions[],
): CommandHandlerContext {
  const client: GitClient = {
    gitPath: "git",
    invoke: async (options) => {
      calls.push(options);

      const answer = answers[options.args.join(" ")];

      if (answer === undefined) {
        return result("", false, "fatal: unexpected command");
      }

      return { ...answer(options), argv: ["git", ...options.args] };
    },
  };

  return {
    request: { commandId: "remote.fetch", target: { kind: "none" } },
    target: { kind: "none" },
    cwd: "/repo",
    client,
    signal: new AbortController().signal,
    notifyProgress: (event) => progress.push(event),
  };
}

describe("executeRemoteFetch", () => {
  it("fetches each upstream ref with --progress on the network class", async () => {
    const progress: CommandProgress[] = [];
    const calls: GitInvokeOptions[] = [];
    const context = createContext(
      {
        [GROUPS_ARGS]: () =>
          result(
            `${upstreamRow("main", "origin", "main")}\n${upstreamRow("feature", "origin", "feature")}\n`,
          ),
        "fetch --progress -- origin +refs/heads/main:refs/remotes/origin/main": (options) => {
          options.onStderr?.("Receiving objects: 42%\r\n");

          return result("");
        },
        "fetch --progress -- origin +refs/heads/feature:refs/remotes/origin/feature": () =>
          result(""),
      },
      progress,
      calls,
    );

    const outcome = await executeRemoteFetch(context);

    expect(outcome.steps).toHaveLength(2);
    expect(outcome.steps[0]?.argv).toEqual([
      "git",
      "fetch",
      "--progress",
      "--",
      "origin",
      "+refs/heads/feature:refs/remotes/origin/feature",
    ]);
    expect(outcome.steps[0]?.argv[5]?.startsWith("+refs/heads/feature:")).toBeTrue();
    expect(calls[1]?.operationClass).toBe("network");
    expect(calls[2]?.operationClass).toBe("network");
    expect(outcome.remoteResults).toEqual([{ remote: "origin", succeeded: true }]);
    expect(progress).toEqual([{ phase: "Receiving objects", percent: 42 }]);
  });

  it("fetches a slash-named remote under its full name", async () => {
    const progress: CommandProgress[] = [];
    const calls: GitInvokeOptions[] = [];
    const context = createContext(
      {
        [GROUPS_ARGS]: () => result(`${upstreamRow("main", "a/b", "main")}\n`),
        "fetch --progress -- a/b +refs/heads/main:refs/remotes/a/b/main": () => result(""),
      },
      progress,
      calls,
    );

    const outcome = await executeRemoteFetch(context);

    expect(outcome.steps[0]?.argv).toEqual([
      "git",
      "fetch",
      "--progress",
      "--",
      "a/b",
      "+refs/heads/main:refs/remotes/a/b/main",
    ]);
    expect(outcome.remoteResults).toEqual([{ remote: "a/b", succeeded: true }]);
  });

  it("continues after one remote group fails", async () => {
    const progress: CommandProgress[] = [];
    const calls: GitInvokeOptions[] = [];
    const context = createContext(
      {
        [GROUPS_ARGS]: () =>
          result(
            `${upstreamRow("main", "origin", "main")}\n${upstreamRow("upstream/main", "upstream", "main")}\n`,
          ),
        "fetch --progress -- origin +refs/heads/main:refs/remotes/origin/main": () =>
          result("", false, "fatal: could not resolve host"),
        "fetch --progress -- upstream +refs/heads/main:refs/remotes/upstream/main": () =>
          result(""),
      },
      progress,
      calls,
    );

    const outcome = await executeRemoteFetch(context);

    expect(outcome.steps).toHaveLength(2);
    expect(outcome.steps[0]?.exitCode).toBe(1);
    expect(outcome.steps[1]?.exitCode).toBe(0);
    expect(outcome.warnings).toEqual([]);
    expect(outcome.remoteResults).toEqual([
      { remote: "origin", succeeded: false },
      { remote: "upstream", succeeded: true },
    ]);
  });

  it("treats a truncated upstream-scope read as a failed command", async () => {
    const progress: CommandProgress[] = [];
    const calls: GitInvokeOptions[] = [];
    const context = createContext(
      {
        [GROUPS_ARGS]: () => ({
          ...result(`${upstreamRow("main", "origin", "main")}\n`),
          stdoutTruncated: true,
        }),
      },
      progress,
      calls,
    );

    const outcome = await executeRemoteFetch(context);

    expect(outcome.steps).toHaveLength(1);
    expect(outcome.steps[0]?.stdoutTruncated).toBeTrue();
    expect(outcome.failed).toBeTrue();
    expect(outcome.remoteResults).toBeUndefined();
    expect(calls.filter((call) => call.args[0] === "fetch")).toHaveLength(0);
  });

  it("returns a blocked outcome when no local branch has an upstream", async () => {
    const progress: CommandProgress[] = [];
    const calls: GitInvokeOptions[] = [];
    const context = createContext(
      {
        [GROUPS_ARGS]: () => result(""),
      },
      progress,
      calls,
    );

    const outcome = await executeRemoteFetch(context);

    expect(outcome.steps).toHaveLength(0);
    expect(outcome.blockedReason).toBe("no-local-upstreams");
    expect(calls).toHaveLength(1);
  });

  it("keeps a missing upstream ref non-fatal beside a healthy ref", async () => {
    const progress: CommandProgress[] = [];
    const calls: GitInvokeOptions[] = [];
    const context = createContext(
      {
        [GROUPS_ARGS]: () =>
          result(
            `${upstreamRow("main", "origin", "main")}\n${upstreamRow("feature", "origin", "feature")}\n`,
          ),
        "fetch --progress -- origin +refs/heads/feature:refs/remotes/origin/feature": () =>
          result("", false, "fatal: couldn't find remote ref refs/heads/feature"),
        "fetch --progress -- origin +refs/heads/main:refs/remotes/origin/main": () => result(""),
      },
      progress,
      calls,
    );

    const outcome = await executeRemoteFetch(context);

    expect(outcome.steps).toHaveLength(2);
    expect(outcome.warnings).toEqual(["upstream not found for origin/feature"]);
    expect(outcome.steps[0]?.argv).toContain("+refs/heads/feature:refs/remotes/origin/feature");
    expect(outcome.steps[0]?.nonFatal).toBeTrue();
    expect(outcome.steps[1]?.nonFatal).toBeUndefined();
    expect(outcome.steps[1]?.exitCode).toBe(0);
    expect(outcome.cancelled).toBeUndefined();
    expect(outcome.timedOut).toBeUndefined();
    expect(outcome.remoteResults).toEqual([{ remote: "origin", succeeded: true }]);
  });
});
