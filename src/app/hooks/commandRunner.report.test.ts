import { describe, expect, it } from "bun:test";
import { formatThrownFailure, reportUnexpectedFailure } from "@/app/hooks/commandRunner.report";
import type { CommandFailureReport } from "@/app/hooks/useCommandRunner.types";
import type { CommandRequest } from "@/domain/commands/commands.types";
import type { ConsoleEntry } from "@/domain/console/console.types";

/** Request used by the reporting tests. */
const REQUEST: CommandRequest = { commandId: "remote.fetch", target: { kind: "none" } };

/**
 * Builds one successful console entry.
 *
 * @param overrides - Entry fields to override.
 * @returns The entry.
 */
function entry(overrides: Partial<ConsoleEntry> = {}): ConsoleEntry {
  return {
    id: "entry-1",
    at: 0,
    commandId: "remote.fetch",
    operationLabel: "Fetch",
    steps: [],
    cwd: null,
    status: "success",
    exitCode: 0,
    durationMs: 1,
    phase: null,
    cancelled: false,
    timedOut: false,
    summary: "completed",
    decisiveError: null,
    ...overrides,
  };
}

/**
 * Runs `reportUnexpectedFailure` with recording collaborators.
 *
 * @param error - Error to report.
 * @param appendedEntry - Entry that was appended before the failure, or null.
 * @returns The recorded collaborators.
 */
function report(
  error: unknown,
  appendedEntry: ConsoleEntry | null = null,
): {
  readonly appended: ConsoleEntry[];
  readonly replaced: ConsoleEntry[];
  readonly reports: CommandFailureReport[];
  readonly ended: number;
} {
  const appended: ConsoleEntry[] = [];
  const replaced: ConsoleEntry[] = [];
  const reports: CommandFailureReport[] = [];
  let ended = 0;

  reportUnexpectedFailure(
    {
      request: REQUEST,
      operationLabel: "Fetch",
      cwd: "/repo",
      repositoryRoot: "/repo",
      append: (candidate) => appended.push(candidate),
      replaceEntry: (candidate) => replaced.push(candidate),
      closeOriginatingOverlay: () => {},
      endOperation: () => {
        ended += 1;
      },
      errorSink: (failure) => reports.push(failure),
      appendedEntry,
    },
    error,
  );

  return { appended, replaced, reports, ended };
}

describe("formatThrownFailure", () => {
  it("flattens a multi-line thrown message onto one summary row", () => {
    const failure = formatThrownFailure({
      commandId: "remote.fetch",
      operationLabel: "Fetch",
      cwd: "/repo",
      repositoryRoot: "/repo",
      message: "fatal: first line\nsecond line\tthird line",
      id: "entry-1",
      at: 0,
    });

    expect(failure.summary).toBe("fatal: first line second line third line");
    expect(failure.decisiveError).toBe("fatal: first line second line third line");
    expect(failure.summary).not.toContain("\n");
    expect(failure.summary).not.toContain("\t");
  });
});

describe("reportUnexpectedFailure", () => {
  it("appends one entry and caps the overlay details", () => {
    const message = Array.from({ length: 120 }, (_, index) => `line ${index}`).join("\n");
    const result = report(new Error(message));

    expect(result.appended).toHaveLength(1);
    expect(result.replaced).toHaveLength(0);
    expect(result.ended).toBe(1);
    expect(result.appended[0]?.status).toBe("failure");
    expect(result.appended[0]?.summary).toContain("line 0");
    expect(result.appended[0]?.summary).not.toContain("\n");
    expect(result.reports).toHaveLength(1);
    expect(result.reports[0]?.message).toBe(message);
    expect(result.reports[0]?.details).toContain("lines omitted");
    expect(result.reports[0]?.details).toContain("line 0");
    expect(result.reports[0]?.details).toContain("line 119");
    expect(Object.hasOwn(result.reports[0] ?? {}, "result")).toBe(false);
  });

  it("replaces an appended entry and labels a refresh failure distinctly", () => {
    const result = report(new Error("refresh\nexploded"), entry());

    expect(result.appended).toHaveLength(0);
    expect(result.replaced).toHaveLength(1);
    expect(result.replaced[0]).toMatchObject({
      id: "entry-1",
      status: "failure",
      operationLabel: "Refresh after Fetch",
      summary: "refresh exploded",
      decisiveError: "refresh exploded",
    });
    expect(result.reports[0]?.operationLabel).toBe("Refresh after Fetch");
    expect(result.reports[0]?.message).toBe("refresh\nexploded");
    expect(result.reports[0]?.consoleEntryId).toBe("entry-1");
  });
});
