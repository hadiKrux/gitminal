import { describe, expect, it } from "bun:test";
import { executeRemoteFetch } from "@/domain/commands/commands.fetch";
import type { CommandHandlerContext, CommandProgress } from "@/domain/commands/commands.types";
import type { GitClient, GitInvocationResult, GitInvokeOptions } from "@/domain/git/git.types";

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
        "for-each-ref --format=%(refname:short) %(upstream:short) refs/heads": () =>
          result("main origin/main\nfeature origin/feature\n"),
        "fetch --progress origin +refs/heads/main:refs/remotes/origin/main": (options) => {
          options.onStderr?.("Receiving objects: 42%\r\n");

          return result("");
        },
        "fetch --progress origin +refs/heads/feature:refs/remotes/origin/feature": () => result(""),
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
      "origin",
      "+refs/heads/feature:refs/remotes/origin/feature",
    ]);
    expect(outcome.steps[0]?.argv[4]?.startsWith("+refs/heads/feature:")).toBeTrue();
    expect(calls[1]?.operationClass).toBe("network");
    expect(calls[2]?.operationClass).toBe("network");
    expect(outcome.remoteResults).toEqual([{ remote: "origin", succeeded: true }]);
    expect(progress).toEqual([{ phase: "Receiving objects", percent: 42 }]);
  });

  it("continues after one remote group fails", async () => {
    const progress: CommandProgress[] = [];
    const calls: GitInvokeOptions[] = [];
    const context = createContext(
      {
        "for-each-ref --format=%(refname:short) %(upstream:short) refs/heads": () =>
          result("main origin/main\nupstream/main upstream/main\n"),
        "fetch --progress origin +refs/heads/main:refs/remotes/origin/main": () =>
          result("", false, "fatal: could not resolve host"),
        "fetch --progress upstream +refs/heads/main:refs/remotes/upstream/main": () => result(""),
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

  it("returns a blocked outcome when no local branch has an upstream", async () => {
    const progress: CommandProgress[] = [];
    const calls: GitInvokeOptions[] = [];
    const context = createContext(
      {
        "for-each-ref --format=%(refname:short) %(upstream:short) refs/heads": () => result(""),
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
        "for-each-ref --format=%(refname:short) %(upstream:short) refs/heads": () =>
          result("main origin/main\nfeature origin/feature\n"),
        "fetch --progress origin +refs/heads/feature:refs/remotes/origin/feature": () =>
          result("", false, "fatal: couldn't find remote ref refs/heads/feature"),
        "fetch --progress origin +refs/heads/main:refs/remotes/origin/main": () => result(""),
      },
      progress,
      calls,
    );

    const outcome = await executeRemoteFetch(context);

    expect(outcome.steps).toHaveLength(2);
    expect(outcome.warnings).toEqual(["upstream not found for feature"]);
    expect(outcome.steps[0]?.argv).toContain("+refs/heads/feature:refs/remotes/origin/feature");
    expect(outcome.steps[0]?.nonFatal).toBeTrue();
    expect(outcome.steps[1]?.nonFatal).toBeUndefined();
    expect(outcome.steps[1]?.exitCode).toBe(0);
    expect(outcome.cancelled).toBeUndefined();
    expect(outcome.timedOut).toBeUndefined();
    expect(outcome.remoteResults).toEqual([{ remote: "origin", succeeded: true }]);
  });
});
