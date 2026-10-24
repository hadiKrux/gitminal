import { describe, expect, it } from "bun:test";
import { parseRemoteVerbose, readRemotes } from "@/domain/git/git.remotes";
import type { GitClient, GitInvocationResult } from "@/domain/git/git.types";

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
    stderr: ok ? "" : "fatal: nope",
    durationMs: 1,
    cancelled: false,
    timedOut: false,
    timedOutAfterMs: null,
    spawnError: null,
    ok,
  };
}

describe("parseRemoteVerbose", () => {
  it("reads fetch and push URLs", () => {
    const remotes = parseRemoteVerbose(
      [
        "origin\thttps://example.com/repo.git (fetch)",
        "origin\tgit@example.com:repo.git (push)",
        "",
      ].join("\n"),
    );

    expect(remotes).toEqual([
      {
        name: "origin",
        fetchUrl: "https://example.com/repo.git",
        pushUrl: "git@example.com:repo.git",
      },
    ]);
  });

  it("reports a null push URL when it matches the fetch URL", () => {
    const remotes = parseRemoteVerbose(
      [
        "origin\thttps://example.com/repo.git (fetch)",
        "origin\thttps://example.com/repo.git (push)",
      ].join("\n"),
    );

    expect(remotes[0]?.pushUrl).toBeNull();
  });

  it("keeps multiple remotes in first-seen order", () => {
    const remotes = parseRemoteVerbose(
      [
        "upstream\thttps://example.com/upstream.git (fetch)",
        "upstream\thttps://example.com/upstream.git (push)",
        "origin\thttps://example.com/origin.git (fetch)",
        "origin\thttps://example.com/origin.git (push)",
      ].join("\n"),
    );

    expect(remotes.map((remote) => remote.name)).toEqual(["upstream", "origin"]);
  });

  it("ignores malformed lines", () => {
    expect(parseRemoteVerbose("origin without marker\n\n")).toEqual([]);
  });
});

describe("readRemotes", () => {
  it("runs git remote -v and parses the result", async () => {
    let args: readonly string[] = [];
    const client: GitClient = {
      gitPath: "git",
      invoke: async (options) => {
        args = options.args;

        return result("origin\thttps://example.com/repo.git (fetch)\n");
      },
    };

    const remotes = await readRemotes(client, {
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(args).toEqual(["remote", "-v"]);
    expect(remotes.ok).toBeTrue();
    expect(remotes.remotes).toHaveLength(1);
  });

  it("returns an empty list for a repository without remotes", async () => {
    const client: GitClient = {
      gitPath: "git",
      invoke: async () => result(""),
    };

    const remotes = await readRemotes(client, {
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(remotes).toEqual({ ok: true, remotes: [], failure: null });
  });

  it("returns a classified failure", async () => {
    const client: GitClient = {
      gitPath: "git",
      invoke: async () => result("", false),
    };

    const remotes = await readRemotes(client, {
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(remotes.ok).toBeFalse();
    expect(remotes.failure?.kind).toBe("unknown");
  });
});
