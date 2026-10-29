import { describe, expect, it } from "bun:test";
import { executeRemoteFetch } from "@/domain/commands/commands.fetch";
import {
  buildFetchFormValues,
  readEmptyFetchScopeReason,
  readFetchBranch,
  readFetchScope,
  readScopedUpstreamGroups,
} from "@/domain/commands/commands.fetch.scope";
import type {
  CommandFormValues,
  CommandHandlerContext,
  CommandProgress,
} from "@/domain/commands/commands.types";
import type { GitClient, GitInvocationResult, GitInvokeOptions } from "@/domain/git/git.types";

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
 * @param formValues - Optional request form values carrying the fetch scope and branch.
 * @returns The handler context.
 */
function createContext(
  answers: Readonly<Record<string, (options: GitInvokeOptions) => GitInvocationResult>>,
  progress: CommandProgress[],
  calls: GitInvokeOptions[],
  formValues?: CommandFormValues,
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
    request: {
      commandId: "remote.fetch",
      target: { kind: "none" },
      ...(formValues === undefined ? {} : { formValues }),
    },
    target: { kind: "none" },
    cwd: "/repo",
    client,
    signal: new AbortController().signal,
    notifyProgress: (event) => progress.push(event),
  };
}

describe("fetch form values", () => {
  it("builds and reads back the scope and branch a request carries", () => {
    const values = buildFetchFormValues("current", "feature");

    expect(values).toEqual({ fetchScope: "current", branch: "feature" });
    expect(readFetchScope(values)).toBe("current");
    expect(readFetchBranch(values)).toBe("feature");
    expect(readFetchScope(undefined)).toBe("local");
    expect(readFetchBranch(undefined)).toBeNull();
    expect(readFetchBranch(buildFetchFormValues("current", ""))).toBeNull();
  });

  it("treats a detached request as having no upstreams in the current scope", () => {
    const stdout = `${upstreamRow("main", "origin", "main")}\n`;
    const detached = buildFetchFormValues("current", "");

    expect(readScopedUpstreamGroups(stdout, detached)).toEqual([]);
    expect(readEmptyFetchScopeReason(detached)).toBe("no-current-upstream");
    expect(readScopedUpstreamGroups(stdout, buildFetchFormValues("local", ""))).toHaveLength(1);
  });
});
describe("executeRemoteFetch", () => {
  it.each(["origin", "upstream", "team/upstream"])(
    "fetches configured refspecs of %s independently of local upstream scope",
    async (remote) => {
      const calls: GitInvokeOptions[] = [];
      const context = createContext(
        {
          remote: () => result("origin\nupstream\nteam/upstream\n"),
          [`config --get-all remote.${remote}.fetch`]: () =>
            result(`+refs/heads/*:refs/remotes/${remote}/*\n`),
          [`fetch --progress --no-prune --no-prune-tags -- ${remote}`]: () => result(""),
        },
        [],
        calls,
        { remote, fetchScope: "current", branch: "" },
      );
      const outcome = await executeRemoteFetch(context);
      expect(outcome.failed).toBeFalse();
      expect(outcome.remoteResults).toEqual([{ remote, succeeded: true }]);
      expect(calls[2]?.operationClass).toBe("network");
      expect(calls[2]?.args).toEqual([
        "fetch",
        "--progress",
        "--no-prune",
        "--no-prune-tags",
        "--",
        remote,
      ]);
    },
  );

  it.each([
    "+refs/heads/*:refs/heads/*",
    "+refs/*:refs/*",
    "refs/heads/main:feature",
    "refs/heads/main:refs/heads/other",
    "+refs/heads/*:refs/h*",
  ])("refuses local-head destination %s before contacting any remote", async (refspec) => {
    const calls: GitInvokeOptions[] = [];
    const outcome = await executeRemoteFetch(
      createContext(
        {
          remote: () => result("origin\n"),
          "config --get-all remote.origin.fetch": () => result(refspec),
        },
        [],
        calls,
      ),
    );
    expect(outcome.blockedReason).toBe("unsafe-fetch-refspec");
    expect(outcome.steps).toEqual([]);
    expect(calls.some((call) => call.args[0] === "fetch")).toBeFalse();
  });

  it.each([
    "",
    "+refs/heads/release/*:refs/remotes/origin/release/*",
    "refs/tags/*:refs/tags/*",
    "refs/heads/main:refs/hea",
    "^refs/heads/private/*",
  ])("preserves safe configured mapping %s", async (refspec) => {
    const outcome = await executeRemoteFetch(
      createContext(
        {
          remote: () => result("origin\n"),
          "config --get-all remote.origin.fetch": () => result(refspec),
          "fetch --progress --no-prune --no-prune-tags -- origin": () => result(""),
        },
        [],
        [],
      ),
    );
    expect(outcome.failed).toBeFalse();
    expect(outcome.remoteResults).toEqual([{ remote: "origin", succeeded: true }]);
  });

  it("fails closed when fetch configuration cannot be read completely", async () => {
    const calls: GitInvokeOptions[] = [];
    const outcome = await executeRemoteFetch(
      createContext(
        {
          remote: () => result("origin\n"),
          "config --get-all remote.origin.fetch": () => ({
            ...result("+refs/heads/*:refs/remotes/origin/*"),
            stdoutTruncated: true,
          }),
        },
        [],
        calls,
      ),
    );
    expect(outcome.failed).toBeTrue();
    expect(calls.some((call) => call.args[0] === "fetch")).toBeFalse();
  });

  it("defaults to origin and refuses absent remotes without fetching", async () => {
    const calls: GitInvokeOptions[] = [];
    const outcome = await executeRemoteFetch(
      createContext({ remote: () => result("upstream\n") }, [], calls),
    );
    expect(outcome.blockedReason).toBe("unknown-remote");
    expect(calls).toHaveLength(1);
  });

  it("reports network failure without advancing freshness", async () => {
    const outcome = await executeRemoteFetch(
      createContext(
        {
          remote: () => result("origin\n"),
          "config --get-all remote.origin.fetch": () =>
            result("+refs/heads/*:refs/remotes/origin/*\n"),
          "fetch --progress --no-prune --no-prune-tags -- origin": () =>
            result("", false, "network failure"),
        },
        [],
        [],
      ),
    );
    expect(outcome.failed).toBeTrue();
    expect(outcome.remoteResults).toEqual([{ remote: "origin", succeeded: false }]);
  });
});
