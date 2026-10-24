import { describe, expect, it } from "bun:test";
import {
  readGitIdentity,
  readHeadProbe,
  readOperationProbe,
  readRepositoryProbe,
} from "@/domain/git/git.repo";
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

/**
 * Builds a client that answers from a command table.
 *
 * @param answers - Map from joined arguments to a result.
 * @returns The fake client.
 */
function createClient(answers: Readonly<Record<string, GitInvocationResult>>): GitClient {
  return {
    gitPath: "git",
    invoke: async (options) => {
      const key = options.args.join(" ");

      return answers[key] ?? result("", false);
    },
  };
}

describe("readRepositoryProbe", () => {
  it("reports a normal work tree and its absolute paths", async () => {
    const client = createClient({
      "rev-parse --is-inside-work-tree": result("true\n"),
      "rev-parse --is-bare-repository --absolute-git-dir": result("false\n/repo/.git\n"),
      "rev-parse --show-toplevel": result("/repo\n"),
    });

    const probe = await readRepositoryProbe(client, {
      cwd: "/repo/src",
      signal: new AbortController().signal,
    });

    expect(probe).toEqual({
      insideWorkTree: true,
      bare: false,
      root: "/repo",
      gitDir: "/repo/.git",
    });
  });

  it("reports a bare repository without a work-tree root", async () => {
    const client = createClient({
      "rev-parse --is-inside-work-tree": result("false\n"),
      "rev-parse --is-bare-repository --absolute-git-dir": result("true\n/srv/repo.git\n"),
    });

    const probe = await readRepositoryProbe(client, {
      cwd: "/srv/repo.git",
      signal: new AbortController().signal,
    });

    expect(probe).toEqual({
      insideWorkTree: false,
      bare: true,
      root: null,
      gitDir: "/srv/repo.git",
    });
  });

  it("reports a directory outside any repository without throwing", async () => {
    const client = createClient({});

    const probe = await readRepositoryProbe(client, {
      cwd: "/tmp",
      signal: new AbortController().signal,
    });

    expect(probe).toEqual({
      insideWorkTree: false,
      bare: false,
      root: null,
      gitDir: null,
    });
  });
});

describe("readHeadProbe", () => {
  it("reports an attached branch", async () => {
    const client = createClient({
      "rev-parse --verify HEAD": result("abc123\n"),
      "symbolic-ref -q --short HEAD": result("main\n"),
    });

    const probe = await readHeadProbe(client, {
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(probe).toEqual({ exists: true, branch: "main", detached: false, shortHash: null });
  });

  it("reports an unborn branch on an empty repository", async () => {
    const client = createClient({
      "symbolic-ref -q --short HEAD": result("main\n"),
    });

    const probe = await readHeadProbe(client, {
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(probe).toEqual({ exists: false, branch: "main", detached: false, shortHash: null });
  });

  it("reports a detached HEAD with its short hash", async () => {
    const client = createClient({
      "rev-parse --verify HEAD": result("abc123\n"),
      "rev-parse --short HEAD": result("abc123\n"),
    });

    const probe = await readHeadProbe(client, {
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(probe).toEqual({
      exists: true,
      branch: null,
      detached: true,
      shortHash: "abc123",
    });
  });
});

describe("readOperationProbe", () => {
  it("reads each pseudo ref independently", async () => {
    const client = createClient({
      "rev-parse --verify --quiet MERGE_HEAD": result("abc\n"),
      "rev-parse --verify --quiet REBASE_HEAD": result("", false),
      "rev-parse --verify --quiet CHERRY_PICK_HEAD": result("def\n"),
    });

    const probe = await readOperationProbe(client, {
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(probe).toEqual({
      mergeInProgress: true,
      rebaseInProgress: false,
      cherryPickInProgress: true,
    });
  });

  it("reports no operation during a normal state", async () => {
    const client = createClient({});

    const probe = await readOperationProbe(client, {
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(probe).toEqual({
      mergeInProgress: false,
      rebaseInProgress: false,
      cherryPickInProgress: false,
    });
  });

  it("reports a paused rebase from the current patch", async () => {
    const client = createClient({
      "rebase --show-current-patch": result("commit abc\n"),
    });

    const probe = await readOperationProbe(client, {
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(probe.rebaseInProgress).toBeTrue();
  });

  it("falls back to REBASE_HEAD when no current patch is shown", async () => {
    const client = createClient({
      "rev-parse --verify --quiet REBASE_HEAD": result("abc\n"),
    });

    const probe = await readOperationProbe(client, {
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(probe.rebaseInProgress).toBeTrue();
  });
});

describe("readGitIdentity", () => {
  it("reads a configured identity", async () => {
    const client = createClient({
      "config user.name": result("Test User\n"),
      "config user.email": result("test@example.com\n"),
    });

    const identity = await readGitIdentity(client, {
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(identity).toEqual({ name: "Test User", email: "test@example.com" });
  });

  it("reports a missing value as null", async () => {
    const client = createClient({
      "config user.name": result("Test User\n"),
    });

    const identity = await readGitIdentity(client, {
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(identity).toEqual({ name: "Test User", email: null });
  });
});
