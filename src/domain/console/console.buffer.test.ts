import { describe, expect, it } from "bun:test";
import {
  appendConsoleEntry,
  CONSOLE_ENTRY_LIMIT,
  capConsoleOutput,
  formatConsoleOmittedMarker,
  parseConsoleOmittedMarker,
  retainExpandedEntryIds,
} from "@/domain/console/console.buffer";
import type { ConsoleEntry } from "@/domain/console/console.types";

/**
 * Builds a minimal console entry.
 *
 * @param id - Entry id.
 * @returns The entry.
 */
function entry(id: string): ConsoleEntry {
  return {
    id,
    at: 0,
    commandId: "app.refresh",
    operationLabel: "Refresh",
    steps: [],
    cwd: null,
    status: "success",
    exitCode: null,
    durationMs: 1,
    phase: null,
    cancelled: false,
    timedOut: false,
    summary: "completed",
    decisiveError: null,
  };
}

describe("appendConsoleEntry", () => {
  it("keeps the newest entries up to the 200-entry bound", () => {
    let entries: readonly ConsoleEntry[] = [];

    for (let index = 0; index < CONSOLE_ENTRY_LIMIT + 5; index += 1) {
      entries = appendConsoleEntry(entries, entry(`entry-${index}`));
    }

    expect(entries).toHaveLength(CONSOLE_ENTRY_LIMIT);
    expect(entries[0]?.id).toBe("entry-5");
    expect(entries.at(-1)?.id).toBe(`entry-${CONSOLE_ENTRY_LIMIT + 4}`);
  });

  it("supports a smaller bound for tests and embedding", () => {
    const entries = appendConsoleEntry(appendConsoleEntry([], entry("a"), 1), entry("b"), 1);

    expect(entries.map((candidate) => candidate.id)).toEqual(["b"]);
  });
});

describe("capConsoleOutput", () => {
  it("keeps the first and last lines and counts the omitted middle", () => {
    const text = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n");
    const block = capConsoleOutput(text, { maxLines: 6 });

    expect(block.totalLines).toBe(20);
    expect(block.omittedLines).toBe(14);
    expect(block.text.split("\n")).toEqual([
      "line 1",
      "line 2",
      "line 3",
      "... 14 lines omitted ...",
      "line 18",
      "line 19",
      "line 20",
    ]);
    expect(block.text).not.toContain("line 10");
  });

  it("caps by bytes while preserving both ends", () => {
    const text = `${"a".repeat(200)}\n${"b".repeat(200)}\n${"c".repeat(200)}`;
    const block = capConsoleOutput(text, { maxBytes: 500 });

    expect(block.text).toContain("aaa");
    expect(block.text).toContain("ccc");
    expect(block.omittedLines).toBeGreaterThan(0);
  });

  it("leaves short output untouched", () => {
    expect(capConsoleOutput("one\ntwo")).toEqual({
      text: "one\ntwo",
      omittedLines: 0,
      totalLines: 2,
    });
  });

  it("applies the documented default line cap", () => {
    const text = Array.from({ length: 250 }, (_, index) => `line ${index}`).join("\n");
    const block = capConsoleOutput(text);

    expect(block.totalLines).toBe(250);
    expect(block.omittedLines).toBeGreaterThan(0);
    expect(block.text.split("\n").length).toBeLessThanOrEqual(201);
  });

  it("applies the documented default byte cap beyond the line cap", () => {
    const lines = Array.from({ length: 300 }, (_, index) => `${index}`.padEnd(120, "x"));
    const text = lines.join("\n");
    const block = capConsoleOutput(text);

    expect(block.omittedLines).toBeGreaterThan(50);
    expect(Buffer.byteLength(block.text, "utf8")).toBeLessThan(Buffer.byteLength(text, "utf8"));
  });

  it("handles empty output", () => {
    expect(capConsoleOutput("")).toEqual({ text: "", omittedLines: 0, totalLines: 0 });
  });
});

describe("console omitted marker", () => {
  it("round-trips the domain-owned marker format", () => {
    expect(formatConsoleOmittedMarker(14)).toBe("... 14 lines omitted ...");
    expect(parseConsoleOmittedMarker("... 14 lines omitted ...")).toBe(14);
  });

  it("rejects a line that is not a marker", () => {
    expect(parseConsoleOmittedMarker("line 14")).toBeNull();
    expect(parseConsoleOmittedMarker("... many lines omitted ...")).toBeNull();
  });
});

describe("retainExpandedEntryIds", () => {
  it("drops ids whose entries were trimmed", () => {
    const retained = retainExpandedEntryIds(new Set(["a", "b"]), [entry("b")]);

    expect([...retained]).toEqual(["b"]);
  });
});
