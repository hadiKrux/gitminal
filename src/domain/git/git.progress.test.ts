import { describe, expect, it } from "bun:test";
import { createGitProgressParser } from "@/domain/git/git.progress";

describe("createGitProgressParser", () => {
  it("reads a percentage delivered across chunk boundaries", () => {
    const parser = createGitProgressParser();

    expect(parser.push("Receiving objects:  4")).toEqual([]);
    expect(parser.push("5% (45/100)\r")).toEqual([{ phase: "Receiving objects", percent: 45 }]);
    expect(parser.bufferedCharacters).toBe(0);
  });

  it("emits a phase-only event when git reports no percentage", () => {
    const parser = createGitProgressParser();

    expect(parser.push("remote: Enumerating objects: 12, done.\n")).toEqual([
      { phase: "Enumerating objects" },
    ]);
  });

  it("emits several events from one chunk and suppresses duplicate redraws", () => {
    const parser = createGitProgressParser();
    const chunk =
      "Counting objects:  10% (1/10)\rCounting objects:  10% (1/10)\rCounting objects: 50% (5/10)\r";

    expect(parser.push(chunk)).toEqual([
      { phase: "Counting objects", percent: 10 },
      { phase: "Counting objects", percent: 50 },
    ]);
  });

  it("ignores transport headers, fatal lines, and non-progress text", () => {
    const parser = createGitProgressParser();

    expect(
      parser.push("From github.com:org/repo\nfatal: could not read\nsome free text\n"),
    ).toEqual([]);
  });

  it("uses the phase before the colon and clamps an impossible percentage", () => {
    const parser = createGitProgressParser();

    expect(parser.push("Delta compression using up to 8 threads: 200%\n")).toEqual([
      { phase: "Delta compression using up to 8 threads" },
    ]);
  });

  it("flushes an unterminated trailing line", () => {
    const parser = createGitProgressParser();

    expect(parser.push("Writing objects: 100% (10/10)")).toEqual([]);
    expect(parser.flush()).toEqual([{ phase: "Writing objects", percent: 100 }]);
  });

  it("keeps a partial line bounded so a stream cannot grow memory", () => {
    const parser = createGitProgressParser();

    parser.push("x".repeat(10_000));

    expect(parser.bufferedCharacters).toBeLessThanOrEqual(4096);
  });

  it("forgets duplicate detection after a reset", () => {
    const parser = createGitProgressParser();

    expect(parser.push("Receiving objects: 10%\n")).toEqual([
      { phase: "Receiving objects", percent: 10 },
    ]);

    parser.reset();

    expect(parser.push("Receiving objects: 10%\n")).toEqual([
      { phase: "Receiving objects", percent: 10 },
    ]);
  });
});
