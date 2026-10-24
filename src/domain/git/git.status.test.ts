import { describe, expect, it } from "bun:test";
import { readStatus, STATUS_ARGS } from "@/domain/git/git.status";
import type { GitClient, GitInvocationResult } from "@/domain/git/git.types";

/**
 * Builds a successful invocation result.
 *
 * @param stdout - Captured output.
 * @returns The synthetic result.
 */
function okResult(stdout: string): GitInvocationResult {
  return {
    argv: ["git"],
    cwd: "/repo",
    exitCode: 0,
    terminationSignal: null,
    stdout,
    stderr: "",
    durationMs: 1,
    cancelled: false,
    timedOut: false,
    timedOutAfterMs: null,
    spawnError: null,
    ok: true,
  };
}

/**
 * Builds a failed invocation result.
 *
 * @param stderr - Captured error output.
 * @returns The synthetic result.
 */
function failResult(stderr: string): GitInvocationResult {
  return {
    argv: ["git"],
    cwd: "/repo",
    exitCode: 128,
    terminationSignal: null,
    stdout: "",
    stderr,
    durationMs: 1,
    cancelled: false,
    timedOut: false,
    timedOutAfterMs: null,
    spawnError: null,
    ok: false,
  };
}

describe("readStatus", () => {
  it("runs the canonical status invocation and parses the output", async () => {
    const calls: string[][] = [];
    const client: GitClient = {
      gitPath: "git",
      invoke: async (options) => {
        calls.push([...options.args]);

        return okResult(
          [
            "# branch.oid abc",
            "# branch.head main",
            "# branch.upstream origin/main",
            "# branch.ab +1 -0",
            "1 M. N... 100644 100644 100644 h1 h1 staged.ts",
            "",
          ].join("\0"),
        );
      },
    };

    const result = await readStatus(client, {
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(calls).toEqual([[...STATUS_ARGS]]);
    expect(STATUS_ARGS).toEqual([
      "status",
      "--porcelain=v2",
      "--branch",
      "-z",
      "--untracked-files=all",
    ]);
    expect(result.ok).toBeTrue();
    expect(result.snapshot?.branch).toBe("main");
    expect(result.snapshot?.ahead).toBe(1);
    expect(result.snapshot?.stagedCount).toBe(1);
    expect(result.failure).toBeNull();
  });

  it("marks the invocation as index-touching", async () => {
    let touchesIndex: boolean | undefined;
    const client: GitClient = {
      gitPath: "git",
      invoke: async (options) => {
        touchesIndex = options.touchesIndex;

        return okResult("");
      },
    };

    await readStatus(client, { cwd: "/repo", signal: new AbortController().signal });

    expect(touchesIndex).toBeTrue();
  });

  it("returns a classified failure instead of throwing", async () => {
    const client: GitClient = {
      gitPath: "git",
      invoke: async () => failResult("fatal: not a git repository (or any parent)"),
    };

    const result = await readStatus(client, {
      cwd: "/tmp",
      signal: new AbortController().signal,
    });

    expect(result.ok).toBeFalse();
    expect(result.snapshot).toBeNull();
    expect(result.failure?.kind).toBe("not-a-repository");
  });
});
