import { describe, expect, it } from "bun:test";
import type { CommandResult, CommandStepResult } from "@/domain/commands/commands.types";
import { formatCommandResult, formatRefreshEntry } from "@/domain/console/console.format";
import { redactCommandResult } from "@/domain/git/git.redact";

/**
 * Builds a command step.
 *
 * @param overrides - Step values to override.
 * @returns The step.
 */
function step(overrides: Partial<CommandStepResult> = {}): CommandStepResult {
  return {
    argv: ["git", "fetch", "--progress", "origin"],
    exitCode: 0,
    durationMs: 12,
    stdout: "",
    stderr: "",
    ...overrides,
  };
}

/**
 * Builds a command result.
 *
 * @param overrides - Result values to override.
 * @returns The result.
 */
function result(overrides: Partial<CommandResult> = {}): CommandResult {
  return {
    commandId: "remote.fetch",
    status: "success",
    operationLabel: "Fetch",
    steps: [step()],
    cwd: "/repo",
    progress: [{ phase: "Receiving objects", percent: 100 }],
    ...overrides,
  };
}

describe("formatCommandResult", () => {
  it("formats a success entry with its step and phase", () => {
    const entry = formatCommandResult(result(), {
      id: "entry-1",
      at: 100,
      repositoryRoot: "/repo",
    });

    expect(entry).toMatchObject({
      id: "entry-1",
      at: 100,
      commandId: "remote.fetch",
      operationLabel: "Fetch",
      status: "success",
      exitCode: 0,
      durationMs: 12,
      phase: "Receiving objects",
      cwd: null,
      cancelled: false,
      timedOut: false,
      decisiveError: null,
    });
    expect(entry.steps).toHaveLength(1);
  });

  it("shows the working directory only when it differs from the root", () => {
    const entry = formatCommandResult(result({ cwd: "/repo/sub" }), {
      id: "entry-1",
      at: 100,
      repositoryRoot: "/repo",
    });

    expect(entry.cwd).toBe("/repo/sub");
  });

  it("selects the decisive stderr line for a failure", () => {
    const entry = formatCommandResult(
      result({
        status: "failure",
        steps: [
          step({
            exitCode: 128,
            stderr: "remote: denied\nfatal: Authentication failed\n",
          }),
        ],
      }),
      { id: "entry-1", at: 100 },
    );

    expect(entry.status).toBe("failure");
    expect(entry.exitCode).toBe(128);
    expect(entry.decisiveError).toBe("fatal: Authentication failed");
    expect(entry.summary).toBe("fatal: Authentication failed");
  });

  it("never reports a cancelled result as success", () => {
    const entry = formatCommandResult(result({ cancelled: true, status: "failure" }), {
      id: "entry-1",
      at: 100,
    });

    expect(entry.status).toBe("cancelled");
    expect(entry.cancelled).toBe(true);
    expect(entry.summary).toBe("cancelled");
    expect(entry.decisiveError).toBeNull();
  });

  it("never reports a timed-out result as success", () => {
    const entry = formatCommandResult(result({ timedOut: true, status: "failure" }), {
      id: "entry-1",
      at: 100,
    });

    expect(entry.status).toBe("timed-out");
    expect(entry.summary).toBe("timed out");
  });

  it("caps each step output", () => {
    const output = Array.from({ length: 50 }, (_, index) => `line ${index}`).join("\n");
    const entry = formatCommandResult(result({ steps: [step({ stdout: output })] }), {
      id: "entry-1",
      at: 100,
      limits: { maxLines: 6 },
    });

    expect(entry.steps[0]?.stdout.omittedLines).toBeGreaterThan(0);
    expect(entry.steps[0]?.stdout.text).toContain("line 0");
  });

  it("formats a redacted result without leaking a credential", () => {
    const raw = result({
      steps: [
        step({
          argv: ["git", "fetch", "https://user:secret@example.com/repo.git"],
          stderr: "fatal: unable to access https://user:secret@example.com/repo.git",
          exitCode: 128,
        }),
      ],
      status: "failure",
    });
    const entry = formatCommandResult(redactCommandResult(raw), { id: "entry-1", at: 100 });

    expect(JSON.stringify(entry)).not.toContain("secret");
    expect(entry.steps[0]?.argv.join(" ")).toContain("[redacted]");
  });

  it("flattens warnings that reach the summary row", () => {
    const entry = formatCommandResult(result({ warnings: ["upstream\nnot\tfound"] }), {
      id: "entry-1",
      at: 100,
    });

    expect(entry.summary).toBe("1 step completed; upstream not found");
  });

  it("derives the row exit code from the last step that reported one", () => {
    const entry = formatCommandResult(
      result({
        steps: [
          step(),
          step({
            argv: ["git", "remote", "prune", "--", "origin"],
            exitCode: null,
            timedOut: true,
            nonFatal: true,
          }),
        ],
      }),
      { id: "entry-1", at: 100 },
    );

    expect(entry.status).toBe("success");
    expect(entry.exitCode).toBe(0);
  });

  it("reports no exit code when a fatal step reported none", () => {
    const entry = formatCommandResult(
      result({
        steps: [
          step(),
          step({
            argv: ["git", "update-ref", "-d", "--", "refs/remotes/origin/feature"],
            exitCode: null,
            stderr: "fatal: child terminated by SIGKILL",
          }),
        ],
        status: "failure",
      }),
      { id: "entry-1", at: 100 },
    );

    expect(entry.status).toBe("failure");
    expect(entry.exitCode).toBeNull();
  });
});

describe("formatRefreshEntry", () => {
  it("formats a successful manual refresh", () => {
    const entry = formatRefreshEntry({
      id: "refresh-1",
      at: 100,
      ok: true,
      message: "Repository refreshed",
      durationMs: 20,
      repositoryRoot: "/repo",
      cwd: "/repo",
    });

    expect(entry).toMatchObject({
      commandId: "app.refresh",
      operationLabel: "Refresh",
      status: "success",
      steps: [],
      cwd: null,
      summary: "Repository refreshed",
    });
  });

  it("formats a failed refresh with its message as the decisive error", () => {
    const entry = formatRefreshEntry({
      id: "refresh-1",
      at: 100,
      ok: false,
      message: "status read failed",
      durationMs: 20,
    });

    expect(entry.status).toBe("failure");
    expect(entry.decisiveError).toBe("status read failed");
  });

  it("flattens a refresh message onto one summary row", () => {
    const entry = formatRefreshEntry({
      id: "refresh-1",
      at: 100,
      ok: false,
      message: "status\nread\tfailed",
      durationMs: 20,
    });

    expect(entry.summary).toBe("status read failed");
    expect(entry.decisiveError).toBe("status read failed");
  });

  it("flattens a refresh cwd onto one row", () => {
    const entry = formatRefreshEntry({
      id: "refresh-1",
      at: 100,
      ok: true,
      message: "Repository refreshed",
      durationMs: 20,
      repositoryRoot: "/repo",
      cwd: "/repo\nworktree\tpath",
    });

    expect(entry.cwd).toBe("/repo worktree path");
  });
});
