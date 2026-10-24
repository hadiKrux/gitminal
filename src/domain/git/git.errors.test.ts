import { describe, expect, it } from "bun:test";
import { classifyGitFailure, isGitFailure } from "@/domain/git/git.errors";
import type { GitInvocationResult, GitSpawnFailure } from "@/domain/git/git.types";

/**
 * Builds an invocation result with sensible defaults for classification tests.
 *
 * @param overrides - Result fields to override.
 * @returns The synthetic result.
 */
function result(overrides: Partial<GitInvocationResult> = {}): GitInvocationResult {
  return {
    argv: ["git"],
    cwd: "/repo",
    exitCode: 1,
    terminationSignal: null,
    stdout: "",
    stderr: "",
    durationMs: 5,
    cancelled: false,
    timedOut: false,
    timedOutAfterMs: null,
    spawnError: null,
    ok: false,
    ...overrides,
  };
}

/**
 * Builds a spawn failure with a platform code.
 *
 * @param code - Platform error code.
 * @returns The spawn failure.
 */
function spawnFailure(code: string): GitSpawnFailure {
  return { code, message: `spawn failed with ${code}` };
}

describe("classifyGitFailure", () => {
  it("classifies a missing git executable", () => {
    const failure = classifyGitFailure(result({ spawnError: spawnFailure("ENOENT") }));

    expect(failure.kind).toBe("missing-git");
    expect(failure.message).toContain("git executable not found");
  });

  it("classifies an inaccessible executable as a permission failure", () => {
    expect(classifyGitFailure(result({ spawnError: spawnFailure("EACCES") })).kind).toBe(
      "permission",
    );
  });

  it("classifies cancellation before inspecting stderr", () => {
    const failure = classifyGitFailure(
      result({ cancelled: true, stderr: "fatal: Authentication failed" }),
    );

    expect(failure.kind).toBe("cancelled");
    expect(failure.message).toBe("cancelled");
  });

  it("classifies a timeout with its documented message", () => {
    const failure = classifyGitFailure(
      result({ timedOut: true, timedOutAfterMs: 10_000, stderr: "partial output" }),
    );

    expect(failure.kind).toBe("timed-out");
    expect(failure.message).toBe("timed out after 10 seconds");
  });

  it("classifies a not-a-repository error", () => {
    expect(
      classifyGitFailure(result({ stderr: "fatal: not a git repository (or any parent)" })).kind,
    ).toBe("not-a-repository");
  });

  it("classifies authentication and network errors", () => {
    expect(
      classifyGitFailure(result({ stderr: "fatal: Authentication failed for 'https://host/'" }))
        .kind,
    ).toBe("auth-network");
    expect(
      classifyGitFailure(
        result({ stderr: "fatal: unable to access 'https://host/': Could not resolve host: host" }),
      ).kind,
    ).toBe("auth-network");
    expect(classifyGitFailure(result({ stderr: "Permission denied (publickey)." })).kind).toBe(
      "auth-network",
    );
  });

  it("classifies filesystem permission errors", () => {
    expect(classifyGitFailure(result({ stderr: "error: unable to write: EACCES" })).kind).toBe(
      "permission",
    );
  });

  it("classifies hook failures", () => {
    expect(
      classifyGitFailure(result({ stderr: "error: remote: pre-commit hook declined" })).kind,
    ).toBe("hook-failure");
  });

  it("classifies non-fast-forward rejections", () => {
    expect(
      classifyGitFailure(result({ stderr: "! [rejected] main -> main (non-fast-forward)" })).kind,
    ).toBe("non-fast-forward");
  });

  it("falls back to unknown and still reports a message", () => {
    const failure = classifyGitFailure(result({ stderr: "" }));

    expect(failure.kind).toBe("unknown");
    expect(failure.message).toBe("git exited with code 1");
  });

  it("prefers the last fatal line as the decisive message", () => {
    const failure = classifyGitFailure(
      result({ stderr: "warning: noisy\nfatal: the decisive line\nerror: final" }),
    );

    expect(failure.message).toBe("error: final");
  });
});

describe("isGitFailure", () => {
  it("reports failure for a non-ok result", () => {
    expect(isGitFailure(result())).toBeTrue();
    expect(isGitFailure(result({ ok: true, exitCode: 0 }))).toBeFalse();
  });
});
