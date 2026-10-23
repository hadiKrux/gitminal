import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { report } from "./check-support";

/** Exit code captured before a report test changes it. */
const originalExitCode = process.exitCode;

/**
 * Restores the process exit code so a failing-report test cannot fail the suite.
 */
afterEach(() => {
  process.exitCode = originalExitCode ?? 0;
});

describe("report", () => {
  it("writes warnings to stdout and errors to stderr", () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const error = spyOn(console, "error").mockImplementation(() => {});

    try {
      report(
        "Check",
        [{ file: "src/a.ts", line: 1, message: "bad finding" }],
        [{ file: "src/b.ts", line: 2, message: "warning finding" }],
      );

      const stdout = log.mock.calls.flat().join("\n");
      const stderr = error.mock.calls.flat().join("\n");

      expect(stdout).toContain("warning finding");
      expect(stdout).not.toContain("bad finding");
      expect(stderr).toContain("bad finding");
      expect(process.exitCode).toBe(1);
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });
});
