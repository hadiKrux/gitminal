/** Outcome shown by one console entry. A cancelled or timed-out command is never `success`. */
export type ConsoleEntryStatus = "success" | "failure" | "cancelled" | "timed-out";

/** Bounded text block with its omitted-line count. */
export interface ConsoleOutputBlock {
  /** Retained head and tail joined by the omitted-lines marker. */
  readonly text: string;
  /** Lines removed from the middle of the block. */
  readonly omittedLines: number;
  /** Total lines in the original output. */
  readonly totalLines: number;
}

/** One git invocation inside a console entry. */
export interface ConsoleStepEntry {
  /** Redacted executable and arguments. */
  readonly argv: readonly string[];
  /** Exit code, or null when the child was terminated. */
  readonly exitCode: number | null;
  /** Wall-clock duration in milliseconds. */
  readonly durationMs: number;
  /** Bounded standard output. */
  readonly stdout: ConsoleOutputBlock;
  /** Bounded standard error. */
  readonly stderr: ConsoleOutputBlock;
}

/** One bounded console history entry. */
export interface ConsoleEntry {
  /** Stable entry id, used by expansion and error links. */
  readonly id: string;
  /** Creation time in milliseconds. */
  readonly at: number;
  /** Command id, or `app.refresh` for a manual refresh entry. */
  readonly commandId: string;
  /** Human-readable operation label. */
  readonly operationLabel: string;
  /** Ordered git invocations, already redacted. */
  readonly steps: readonly ConsoleStepEntry[];
  /** Working directory when it differs from the repository root, otherwise null. */
  readonly cwd: string | null;
  /** Entry outcome. */
  readonly status: ConsoleEntryStatus;
  /** Exit code of the last step, or null when no step ran. */
  readonly exitCode: number | null;
  /** Total duration in milliseconds. */
  readonly durationMs: number;
  /** Last progress phase reported while the command ran, or null. */
  readonly phase: string | null;
  /** True when the command was cancelled. */
  readonly cancelled: boolean;
  /** True when the command timed out. */
  readonly timedOut: boolean;
  /** One-line summary shown in the collapsed row. */
  readonly summary: string;
  /** Decisive failure line for a failure entry, otherwise null. */
  readonly decisiveError: string | null;
}

/** Per-output caps applied when an entry is formatted. */
export interface ConsoleCapLimits {
  /** Maximum retained lines per output block. */
  readonly maxLines: number;
  /** Maximum retained UTF-8 bytes per output block. */
  readonly maxBytes: number;
}

/** Options accepted by `formatCommandResult`. */
export interface FormatCommandResultOptions {
  /** Entry id. Callers own id generation so tests can be deterministic. */
  readonly id: string;
  /** Creation time in milliseconds. */
  readonly at: number;
  /** Repository root, used to omit a redundant working directory. */
  readonly repositoryRoot?: string | null;
  /** Output caps. */
  readonly limits?: Partial<ConsoleCapLimits>;
}

/** Input for one manual refresh console entry. */
export interface RefreshConsoleEntryInput {
  /** Entry id. */
  readonly id: string;
  /** Creation time in milliseconds. */
  readonly at: number;
  /** True when the refresh succeeded. */
  readonly ok: boolean;
  /** Summary text. */
  readonly message: string;
  /** Refresh duration in milliseconds. */
  readonly durationMs: number;
  /** Repository root, used to omit a redundant working directory. */
  readonly repositoryRoot?: string | null;
  /** Working directory the refresh used. */
  readonly cwd?: string | null;
}
