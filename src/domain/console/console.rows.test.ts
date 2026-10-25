import { describe, expect, it } from "bun:test";
import {
  readConsoleEntryDetail,
  readConsoleEntryRows,
  readConsolePageStep,
} from "@/domain/console/console.rows";
import type { ConsoleEntry } from "@/domain/console/console.types";

/**
 * Builds one realistic console entry.
 *
 * @param id - Entry id.
 * @param overrides - Entry fields to override.
 * @returns The entry.
 */
function entry(id: string, overrides: Partial<ConsoleEntry> = {}): ConsoleEntry {
  return {
    id,
    at: 0,
    commandId: "remote.fetch",
    operationLabel: "Fetch",
    steps: [
      {
        argv: ["git", "fetch", "--progress", "origin"],
        exitCode: 0,
        durationMs: 12,
        stdout: { text: "", omittedLines: 0, totalLines: 0 },
        stderr: { text: "", omittedLines: 0, totalLines: 0 },
      },
    ],
    cwd: "/repo/sub",
    status: "success",
    exitCode: 0,
    durationMs: 12,
    phase: null,
    cancelled: false,
    timedOut: false,
    summary: "1 step completed",
    decisiveError: null,
    ...overrides,
  };
}

describe("readConsoleEntryRows", () => {
  it("measures the header, argv, cwd, and summary rows of a collapsed entry", () => {
    expect(readConsoleEntryRows(entry("a"), false)).toBe(4);
  });

  it("counts one command-id row when the entry has no step", () => {
    expect(readConsoleEntryRows(entry("a", { steps: [], cwd: null }), false)).toBe(3);
  });

  it("omits an identical cancelled summary row and counts expanded output panes", () => {
    const cancelled = entry("a", {
      status: "cancelled",
      summary: "cancelled",
      cwd: null,
      steps: [
        {
          argv: ["git", "fetch"],
          exitCode: null,
          durationMs: 2,
          stdout: { text: "head\ntail", omittedLines: 0, totalLines: 2 },
          stderr: { text: "fatal", omittedLines: 0, totalLines: 1 },
        },
      ],
    });

    expect(readConsoleEntryRows(cancelled, false)).toBe(2);
    expect(readConsoleEntryRows(cancelled, true)).toBe(2 + 3 + 2);
  });

  it("reads the same detail line the row renders", () => {
    expect(readConsoleEntryDetail(entry("a"))).toEqual({
      phase: null,
      summary: "1 step completed",
    });
    expect(
      readConsoleEntryDetail(entry("a", { status: "cancelled", summary: "cancelled" })),
    ).toEqual({ phase: null, summary: null });
    expect(
      readConsoleEntryDetail(entry("a", { summary: "fatal: nope", phase: "Receiving objects" })),
    ).toEqual({ phase: "Receiving objects", summary: "fatal: nope" });
  });

  it("caps a tall output pane at the documented pane height", () => {
    const expanded = entry("a", {
      steps: [
        {
          argv: ["git", "fetch"],
          exitCode: 0,
          durationMs: 2,
          stdout: {
            text: Array.from({ length: 20 }, (_, index) => `line ${index}`).join("\n"),
            omittedLines: 0,
            totalLines: 20,
          },
          stderr: { text: "", omittedLines: 0, totalLines: 0 },
        },
      ],
    });

    expect(readConsoleEntryRows(expanded, true)).toBe(4 + 1 + 8);
  });
});

describe("readConsolePageStep", () => {
  const entries = Array.from({ length: 8 }, (_, index) => entry(`entry-${index}`));

  it("moves one entry when a single entry is taller than half the viewport", () => {
    expect(
      readConsolePageStep({
        entries,
        currentIndex: 7,
        direction: -1,
        viewportHeight: 5,
        isExpanded: () => false,
      }),
    ).toBe(1);
  });

  it("moves one entry when the start entry is taller than the viewport", () => {
    const tall = entry("tall", {
      steps: Array.from({ length: 6 }, (_, index) => ({
        argv: ["git", "fetch", `origin-${index}`],
        exitCode: 0,
        durationMs: 1,
        stdout: { text: "", omittedLines: 0, totalLines: 0 },
        stderr: { text: "", omittedLines: 0, totalLines: 0 },
      })),
    });
    const history = [tall, entry("next")];

    expect(
      readConsolePageStep({
        entries: history,
        currentIndex: 0,
        direction: 1,
        viewportHeight: 5,
        isExpanded: () => false,
      }),
    ).toBe(1);
  });

  it("subtracts rows reserved by the running spinner", () => {
    expect(
      readConsolePageStep({
        entries,
        currentIndex: 0,
        direction: 1,
        viewportHeight: 9,
        isExpanded: () => false,
      }),
    ).toBe(2);
    expect(
      readConsolePageStep({
        entries,
        currentIndex: 0,
        direction: 1,
        viewportHeight: 9,
        reservedRows: 1,
        isExpanded: () => false,
      }),
    ).toBe(1);
  });

  it("moves the entries whose rows fill the viewport", () => {
    expect(
      readConsolePageStep({
        entries,
        currentIndex: 0,
        direction: 1,
        viewportHeight: 10,
        isExpanded: () => false,
      }),
    ).toBe(2);
  });

  it("stops at the history edge and never returns less than one", () => {
    expect(
      readConsolePageStep({
        entries,
        currentIndex: 7,
        direction: 1,
        viewportHeight: 20,
        isExpanded: () => false,
      }),
    ).toBe(1);
    expect(
      readConsolePageStep({
        entries: [],
        currentIndex: -1,
        direction: 1,
        viewportHeight: 20,
        isExpanded: () => false,
      }),
    ).toBe(1);
  });

  it("uses expanded pane heights when choosing the step", () => {
    const tall = entry("entry-0", {
      steps: [
        {
          argv: ["git", "fetch"],
          exitCode: 0,
          durationMs: 2,
          stdout: {
            text: "one\ntwo\nthree\nfour",
            omittedLines: 0,
            totalLines: 4,
          },
          stderr: { text: "", omittedLines: 0, totalLines: 0 },
        },
      ],
    });
    const history = [tall, entry("entry-1"), entry("entry-2")];

    expect(
      readConsolePageStep({
        entries: history,
        currentIndex: 0,
        direction: 1,
        viewportHeight: 10,
        isExpanded: () => false,
      }),
    ).toBe(2);
    expect(
      readConsolePageStep({
        entries: history,
        currentIndex: 0,
        direction: 1,
        viewportHeight: 10,
        isExpanded: (entryId) => entryId === "entry-0",
      }),
    ).toBe(1);
  });
});
