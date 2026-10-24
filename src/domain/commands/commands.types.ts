import type { GitClient } from "@/domain/git/git.types";
import type { ActionCategory } from "@/domain/keymap/keymap.types";
import type {
  RepositoryGateReason,
  RepositorySignals,
  RepositoryStateSnapshot,
} from "@/domain/repository/repository.types";

/**
 * Focus context a command runs in.
 *
 * The values mirror the shell `RegionId` values plus `overlay`. The domain layer cannot import the
 * feature folder that declares `RegionId`, so this union is the command layer's own copy, matching
 * the approach already used by `KeymapContext`.
 */
export type CommandRegion =
  | "top-bar"
  | "branches"
  | "remotes"
  | "tags"
  | "stashes"
  | "worktrees"
  | "graph"
  | "right-pane"
  | "diff"
  | "console"
  | "overlay";

/** How a command reaches the repository. */
export type CommandKind = "mutation" | "read" | "navigation";

/**
 * Explicit target of a command.
 *
 * Targets are values captured when the command is dispatched, never an ambient cursor read from
 * another feature's component state.
 */
export type CommandTarget =
  | { readonly kind: "none" }
  | { readonly kind: "branch"; readonly name: string }
  | { readonly kind: "remoteBranch"; readonly remote: string; readonly branch: string }
  | { readonly kind: "tag"; readonly name: string; readonly remote?: string }
  | { readonly kind: "stash"; readonly objectName: string }
  | { readonly kind: "worktree"; readonly path: string }
  | { readonly kind: "commit"; readonly oid: string }
  | { readonly kind: "pending" }
  | {
      readonly kind: "diffFile";
      readonly section: string;
      readonly path: string;
      readonly oldPath?: string;
    }
  | { readonly kind: "form"; readonly formId: string };

/** The tag of a target union member. */
export type CommandTargetKind = CommandTarget["kind"];

/** Values collected by a modal form before the command runs. */
export type CommandFormValues = Readonly<Record<string, string | boolean | readonly string[]>>;

/** One catalogue entry describing a command. */
export interface CommandDescriptor {
  /** Stable command id. Most commands reuse their action id. */
  readonly id: string;
  /** Action id when the command is key-bindable. */
  readonly actionId?: string;
  /** How the command reaches the repository. */
  readonly kind: CommandKind;
  /** Focus context that owns the command. */
  readonly scope: CommandRegion | "global";
  /** Target the command requires. */
  readonly targetKind: CommandTargetKind;
  /** Human-readable name used by the palette and help. */
  readonly label: string;
  /** One-line explanation. */
  readonly description: string;
  /** Extra palette search terms. */
  readonly keywords: readonly string[];
  /** Palette and help grouping. */
  readonly category: ActionCategory;
  /** Whether the palette lists the command. */
  readonly paletteInvocable: boolean;
  /** Whether the command opens a modal form instead of running immediately. */
  readonly needsInput: boolean;
}

/** One progress event emitted while a command runs. */
export interface CommandProgress {
  /** Phase label shown in the top bar status strip. */
  readonly phase: string;
  /** Completion percentage when the git command reports one. */
  readonly percent?: number;
}

/** Result of one git invocation inside a command. */
export interface CommandStepResult {
  /** Executable followed by the argument array. */
  readonly argv: readonly string[];
  /** Exit code, or null when the child was terminated. */
  readonly exitCode: number | null;
  /** Wall-clock duration in milliseconds. */
  readonly durationMs: number;
  /** Captured standard output. */
  readonly stdout: string;
  /** Captured standard error. */
  readonly stderr: string;
  /** True when the captured stdout lost its middle to the client output limit. */
  readonly stdoutTruncated?: boolean;
  /** True when the captured stderr lost its middle to the client output limit. */
  readonly stderrTruncated?: boolean;
  /** True when this step was cancelled. */
  readonly cancelled?: boolean;
  /** True when this step timed out. */
  readonly timedOut?: boolean;
  /** Timeout that expired for this step, in milliseconds, or null when it did not time out. */
  readonly timedOutAfterMs?: number | null;
  /**
   * True when a non-zero step is a supported, non-fatal outcome.
   *
   * A scoped Fetch of an upstream whose remote branch no longer exists is the documented case: the
   * command stays a success with a warning, the step is still shown in the console, and the error
   * surface never opens.
   */
  readonly nonFatal?: boolean;
}

/** Status of one executed command. */
export type CommandStatus = "success" | "failure" | "blocked";

/**
 * Result of one command execution.
 *
 * The runner returns this for every outcome: success, a git failure, a blocked request, a
 * cancellation, or a timeout. Callers never catch a thrown git failure.
 */
export interface CommandResult {
  /** Command that was requested. */
  readonly commandId: string;
  /** Outcome category. */
  readonly status: CommandStatus;
  /** Human-readable operation label for the status strip and console entry. */
  readonly operationLabel: string;
  /** Ordered git invocations made by the command. */
  readonly steps: readonly CommandStepResult[];
  /** Working directory the command ran in. */
  readonly cwd: string;
  /** Progress phases emitted while the command ran. */
  readonly progress: readonly CommandProgress[];
  /** Machine-readable reason when the status is `blocked`. */
  readonly blockedReason?: CommandAvailabilityReason;
  /**
   * Warning messages for a successful command with non-fatal outcomes.
   *
   * The orchestrator surfaces them as a warning status instead of a success message, and never
   * routes them to the error surface.
   */
  readonly warnings?: readonly string[];
  /** True when the whole command was cancelled. */
  readonly cancelled?: boolean;
  /** True when the whole command timed out. */
  readonly timedOut?: boolean;
  /** Timeout that expired, in milliseconds, when the command timed out. */
  readonly timedOutAfterMs?: number | null;
}

/** One command dispatch. */
export interface CommandRequest {
  /** Command to run. */
  readonly commandId: string;
  /** Explicit target captured at dispatch time. */
  readonly target: CommandTarget;
  /** Values collected by the owning modal form. */
  readonly formValues?: CommandFormValues;
}

/** Whether a mutation is currently running. */
export type CommandOperation = "idle" | "running";

/** Everything availability needs, passed as plain values from the providers. */
export interface CommandContext {
  /** Detected repository state. */
  readonly state: RepositoryStateSnapshot;
  /** Raw repository signals. */
  readonly signals: RepositorySignals;
  /** Explicit command target. */
  readonly target: CommandTarget;
  /** Focus context that dispatched the command. */
  readonly region: CommandRegion;
  /** Whether another mutation is running. */
  readonly operation: CommandOperation;
}

/** Machine-readable reason a command is unavailable. */
export type CommandAvailabilityReason =
  | RepositoryGateReason
  | "missing-target"
  | "invalid-target"
  | "unknown-remote"
  | "cannot-delete-current-branch"
  | "resolve-conflicts-first"
  | "merge-state"
  | "command-not-found"
  | "not-a-mutation"
  | "command-not-implemented";

/** Availability of one command in one context. */
export interface CommandAvailability {
  /** True when the command may run. */
  readonly available: boolean;
  /** Stable reason, present only when the command is unavailable. */
  readonly reason?: CommandAvailabilityReason;
}

/** Options accepted by `runCommand`. */
export interface CommandRunOptions {
  /** Detected repository state. */
  readonly state: RepositoryStateSnapshot;
  /** Raw repository signals. */
  readonly signals: RepositorySignals;
  /** Explicit command target. */
  readonly target: CommandTarget;
  /** Focus context that dispatched the command. */
  readonly region: CommandRegion;
  /** Cancellation signal owned by the caller. */
  readonly signal?: AbortSignal;
  /** Receives every progress event as it is emitted. */
  readonly onProgress?: (progress: CommandProgress) => void;
  /** Git client override. Defaults to a client using the `git` executable. */
  readonly client?: GitClient;
}

/** Success of one remote inside a command that contacts remotes. */
export interface CommandRemoteResult {
  /** Remote name. */
  readonly remote: string;
  /** True when every invocation for this remote completed without a reported failure. */
  readonly succeeded: boolean;
}

/** Steps produced by one command handler. */
export interface CommandExecutionOutcome {
  /** Ordered git invocations made by the handler. */
  readonly steps: readonly CommandStepResult[];
  /**
   * Per-remote success reported by a handler that contacts remotes.
   *
   * The app layer records success evidence from this list, so a remote that failed is never recorded
   * as a successful check or fetch.
   */
  readonly remoteResults?: readonly CommandRemoteResult[];
  /**
   * Upstream refs a Fetch --prune confirmed absent and deleted locally.
   *
   * Outcome-only evidence. The app-layer wrapper records it through
   * `RepositoryProvider.recordUpstreamEvidence` before it returns the result, so the runner stays a
   * pure executor and the refreshed snapshot classifies those refs as deleted.
   */
  readonly prunedUpstreamRefs?: readonly string[];
  /**
   * Upstream refs whose remote check failed during Fetch --prune.
   *
   * Outcome-only evidence. The app-layer wrapper records it in the same batched evidence write as
   * the pruned refs before returning, so a failed check is never mistaken for a deleted branch and
   * a run with both lists still performs one refresh.
   */
  readonly unknownUpstreamRefs?: readonly string[];
  /** True when the handler observed a cancellation. */
  readonly cancelled?: boolean;
  /** True when the handler observed a timeout. */
  readonly timedOut?: boolean;
  /**
   * True when a composite handler decides the whole command failed even though its individual
   * steps are non-fatal.
   *
   * Fetch --prune sets it when every remote group failed and nothing was fetched or pruned, so a
   * total failure reaches the error surface while partial success stays a warning.
   */
  readonly failed?: boolean;
  /**
   * Reason the handler refuses to execute its scope before doing any work.
   *
   * The scoped Fetch returns this when it resolves zero upstream refs, so a stale availability
   * signal can never turn into a zero-step success.
   */
  readonly blockedReason?: CommandAvailabilityReason;
  /** Warning messages for successful non-fatal outcomes. */
  readonly warnings?: readonly string[];
}

/** Context passed to a registered command handler. */
export interface CommandHandlerContext {
  /** Original request. */
  readonly request: CommandRequest;
  /** Explicit target, already validated by availability. */
  readonly target: CommandTarget;
  /** Repository root the handler must run in. */
  readonly cwd: string;
  /** Git client to use for every invocation. */
  readonly client: GitClient;
  /** Cancellation signal. */
  readonly signal: AbortSignal;
  /** Publishes a progress phase or percentage. */
  readonly notifyProgress: (progress: CommandProgress) => void;
}

/** Executes one mutation command. */
export type CommandHandler = (context: CommandHandlerContext) => Promise<CommandExecutionOutcome>;

/** Registration of one executable mutation. */
export interface CommandHandlerRegistration {
  /** Command this handler executes. */
  readonly commandId: string;
  /** Operation label shown while it runs. */
  readonly operationLabel: string;
  /** Executor. */
  readonly handler: CommandHandler;
}
