import { describe, expect, it } from "bun:test";
import type { CommandResult } from "@/domain/commands/commands.types";
import {
  sanitizeCommandResult,
  sanitizeConsoleLine,
  sanitizeConsoleText,
} from "@/domain/console/console.sanitize";

/** DEL and the C1 range that carries 8-bit CSI and OSC introducers, built without a glyph literal. */
const C1_DEL = String.fromCharCode(0x7f);
const C1_START = String.fromCharCode(0x80);
const C1_END = String.fromCharCode(0x9f);
const C1_CSI = String.fromCharCode(0x9b);
const C1_OSC = String.fromCharCode(0x9d);

/** Bidi overrides, isolates, and invisible marks. */
const BIDI_OVERRIDE = String.fromCharCode(0x202e);
const BIDI_POP = String.fromCharCode(0x202c);
const BIDI_ISOLATE = String.fromCharCode(0x2066);
const BIDI_ISOLATE_END = String.fromCharCode(0x2069);
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
const ZERO_WIDTH_NON_JOINER = String.fromCharCode(0x200c);
const ZERO_WIDTH_JOINER = String.fromCharCode(0x200d);
const LEFT_TO_RIGHT_MARK = String.fromCharCode(0x200e);
const RIGHT_TO_LEFT_MARK = String.fromCharCode(0x200f);
const ARABIC_LETTER_MARK = String.fromCharCode(0x061c);
const WORD_JOINER = String.fromCharCode(0x2060);
const SOFT_HYPHEN = String.fromCharCode(0x00ad);
const BOM = String.fromCharCode(0xfeff);

/**
 * Builds a minimal command result with one step.
 *
 * @param overrides - Step fields to override.
 * @returns The result.
 */
function result(overrides: Partial<CommandResult["steps"][number]> = {}): CommandResult {
  return {
    commandId: "remote.fetch",
    status: "failure",
    operationLabel: "Fetch",
    steps: [
      {
        argv: ["git", "fetch"],
        exitCode: 1,
        durationMs: 1,
        stdout: "",
        stderr: "",
        ...overrides,
      },
    ],
    cwd: "/repo",
    progress: [],
  };
}

describe("sanitizeConsoleText", () => {
  it("removes ANSI color sequences and keeps the visible text", () => {
    expect(sanitizeConsoleText("\u001b[31mfatal\u001b[0m: nope")).toBe("fatal: nope");
    expect(sanitizeConsoleText("\u001b]0;title\u0007output")).toBe("output");
  });

  it("normalizes carriage returns so progress frames cannot overwrite a cell", () => {
    expect(sanitizeConsoleText("one\rtwo")).toBe("one\ntwo");
    expect(sanitizeConsoleText("one\r\ntwo")).toBe("one\ntwo");
  });

  it("removes remaining control bytes while preserving newline and tab", () => {
    expect(sanitizeConsoleText("a\u0000b\u0008c\td\ne")).toBe("abc\td\ne");
  });

  it.each([
    ["C1 CSI", `a${C1_CSI}31mb`, "a31mb"],
    ["C1 OSC", `a${C1_OSC}0;title\u0007b`, "a0;titleb"],
    ["C1 range", `${C1_DEL}${C1_START}${C1_END}text`, "text"],
    ["bidi override", `safe${BIDI_OVERRIDE}gnp.exe${BIDI_POP}`, "safegnp.exe"],
    ["bidi isolate", `a${BIDI_ISOLATE}b${BIDI_ISOLATE_END}c`, "abc"],
    ["zero-width space", `a${ZERO_WIDTH_SPACE}b`, "ab"],
    ["left-to-right mark", `a${LEFT_TO_RIGHT_MARK}b`, "ab"],
    ["right-to-left mark", `a${RIGHT_TO_LEFT_MARK}b`, "ab"],
    ["Arabic letter mark", `a${ARABIC_LETTER_MARK}b`, "ab"],
    ["word joiner", `a${WORD_JOINER}b`, "ab"],
    ["soft hyphen", `a${SOFT_HYPHEN}b`, "ab"],
    ["byte-order mark", `${BOM}title`, "title"],
  ])("removes %s", (_name, value, expected) => {
    expect(sanitizeConsoleText(value)).toBe(expected);
  });

  it("preserves ZWNJ and ZWJ used by Persian, Arabic, Indic, and emoji text", () => {
    expect(sanitizeConsoleText(`a${ZERO_WIDTH_NON_JOINER}b${ZERO_WIDTH_JOINER}c`)).toBe(
      `a${ZERO_WIDTH_NON_JOINER}b${ZERO_WIDTH_JOINER}c`,
    );
  });

  it("is idempotent", () => {
    const value = sanitizeConsoleText(
      `\u001b[1mone\rtwo\u0007${C1_CSI}${BIDI_OVERRIDE}${BOM}${ZERO_WIDTH_JOINER}`,
    );

    expect(sanitizeConsoleText(value)).toBe(value);
  });
});

describe("sanitizeConsoleLine", () => {
  it("maps newlines and tabs to one space", () => {
    expect(sanitizeConsoleLine("a\nb\tc\rd")).toBe("a b c d");
    expect(sanitizeConsoleLine("a\n\n\tb")).toBe("a   b");
  });

  it("removes control sequences before flattening the row", () => {
    expect(sanitizeConsoleLine("\u001b[31mfeature/x\u001b[0m\nnext")).toBe("feature/x next");
  });
});

describe("sanitizeCommandResult", () => {
  it("sanitizes cwd, argv, stdout, and stderr before formatting", () => {
    const sanitized = sanitizeCommandResult({
      ...result({
        argv: ["git", "\u001b[31mfetch"],
        stdout: "out\rframe",
        stderr: "\u001b[31mfatal\u001b[0m",
      }),
      cwd: "/re\u0000po",
    });

    expect(sanitized.cwd).toBe("/repo");
    expect(sanitized.steps[0]?.argv).toEqual(["git", "fetch"]);
    expect(sanitized.steps[0]?.stdout).toBe("out\nframe");
    expect(sanitized.steps[0]?.stderr).toBe("fatal");
  });

  it("flattens argv and cwd without flattening captured output", () => {
    const sanitized = sanitizeCommandResult({
      ...result({
        argv: ["git", "fetch\n--progress", "origin\tbranch"],
        stdout: "line one\nline two",
        stderr: "error one\ttabbed",
      }),
      cwd: "/repo\nworktree",
    });

    expect(sanitized.cwd).toBe("/repo worktree");
    expect(sanitized.steps[0]?.argv).toEqual(["git", "fetch --progress", "origin branch"]);
    expect(sanitized.steps[0]?.stdout).toBe("line one\nline two");
    expect(sanitized.steps[0]?.stderr).toBe("error one\ttabbed");
  });

  it("flattens warnings that reach a summary row", () => {
    const sanitized = sanitizeCommandResult({
      ...result(),
      warnings: ["upstream\nnot\tfound"],
    });

    expect(sanitized.warnings).toEqual(["upstream not found"]);
  });
});
