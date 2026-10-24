import { spawn } from "node:child_process";
import type { GitExecutionSettings, GitIndexLock, GitIndexLockWaiter } from "./git.client.types";
import type {
  GitClient,
  GitClientOptions,
  GitInvocationLane,
  GitInvocationResult,
  GitInvokeOptions,
  GitOperationClass,
  GitOperationTimeouts,
  GitReadableStream,
  GitSpawn,
  GitSpawnedProcess,
  GitSpawnFailure,
  GitSpawnOptions,
} from "./git.types";

/** Default timeout per operation class, in milliseconds. */
export const DEFAULT_GIT_TIMEOUTS: GitOperationTimeouts = Object.freeze({
  read: 10_000,
  write: 30_000,
  network: 120_000,
});

/** Grace between `SIGTERM` and `SIGKILL`, in milliseconds. */
const DEFAULT_KILL_GRACE_MS = 2_000;

/**
 * Grace after a normal exit while waiting for the `close` event, in milliseconds.
 *
 * A descendant that inherits the output pipes can hold `close` open long after the direct child
 * exits. The captured output is already complete at that point, so a short bounded drain prevents a
 * backgrounded process from defeating the invocation timeout or delaying quit.
 */
const DEFAULT_EXIT_FLUSH_GRACE_MS = 100;

/** Maximum captured characters per stream before head and tail truncation. */
const DEFAULT_OUTPUT_LIMIT_CHARACTERS = 1_000_000;

/** Marker inserted where a stream exceeded its capture limit. */
const OUTPUT_TRUNCATION_MARKER = "\n[output truncated]\n";

/** Environment variables that suppress prompts, editors, and pagers. */
export const GIT_ENVIRONMENT_MATRIX: Readonly<Record<string, string>> = Object.freeze({
  GIT_TERMINAL_PROMPT: "0",
  GCM_INTERACTIVE: "never",
  GIT_ASKPASS: "",
  SSH_ASKPASS: "",
  SSH_ASKPASS_REQUIRE: "never",
  GIT_EDITOR: "true",
  GIT_SEQUENCE_EDITOR: "true",
  GIT_PAGER: "cat",
  PAGER: "cat",
  GIT_MERGE_AUTOEDIT: "no",
  LC_ALL: "C",
});

/** SSH command applied only when the user has not configured one. */
const DEFAULT_SSH_COMMAND = "ssh -o BatchMode=yes";

/** Commands whose read observes the index and must not race a write. */
const INDEX_READ_COMMANDS: ReadonlySet<string> = new Set(["status", "diff"]);

/**
 * Builds the child environment for every git invocation.
 *
 * The user's environment is copied first, then the prompt, editor, and pager matrix overwrites the
 * values the app controls. `GIT_SSH_COMMAND` is added only when the user has not configured one, so
 * an explicit `GIT_SSH_COMMAND` or `core.sshCommand` always wins.
 *
 * @param baseEnv - User environment, normally `process.env`.
 * @param sshCommandConfigured - True when the user configured an SSH command.
 * @returns A new environment record safe to pass to the child.
 */
export function buildGitEnvironment(
  baseEnv: Readonly<Record<string, string | undefined>>,
  sshCommandConfigured: boolean,
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(baseEnv)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  Object.assign(env, GIT_ENVIRONMENT_MATRIX);

  if (!sshCommandConfigured) {
    env.GIT_SSH_COMMAND = DEFAULT_SSH_COMMAND;
  }

  return env;
}

/**
 * Resolves the timeout for one operation class.
 *
 * @param operationClass - Local read, local write, or network operation.
 * @param overrides - Per-class overrides supplied by configuration or tests.
 * @returns The timeout in milliseconds.
 */
export function resolveOperationTimeout(
  operationClass: GitOperationClass,
  overrides?: Partial<GitOperationTimeouts>,
): number {
  return overrides?.[operationClass] ?? DEFAULT_GIT_TIMEOUTS[operationClass];
}

/**
 * Creates a git client with its own index lock, SSH detection cache, and timing settings.
 *
 * The returned client is the only production code path that spawns a process. Every invocation
 * carries an argument array, an explicit working directory, no shell, ignored stdin, the prompt and
 * editor environment matrix, a timeout, and an `AbortSignal`. Index-touching reads and writes share
 * one read-write latch, so a status or diff read never observes a half-applied mutation. The client
 * never throws for a git failure; it returns a settled result with `ok`, `cancelled`, and
 * `timedOut` distinguishing success from termination.
 *
 * @param options - Executable, environment, timeout, spawn, and timing seams.
 * @returns A git client bound to those settings.
 */
export function createGitClient(options: GitClientOptions = {}): GitClient {
  const gitPath = options.gitPath ?? "git";
  const baseEnv = options.baseEnv ?? process.env;
  const timeoutOverrides = options.timeouts;
  const spawnProcess = options.spawn ?? defaultSpawn;
  const resolveSshOverride = options.resolveSshCommandConfigured;
  const settings: GitExecutionSettings = {
    killGraceMs: options.killGraceMs ?? DEFAULT_KILL_GRACE_MS,
    exitFlushGraceMs: DEFAULT_EXIT_FLUSH_GRACE_MS,
    outputLimitCharacters: options.outputLimitCharacters ?? DEFAULT_OUTPUT_LIMIT_CHARACTERS,
    now: options.now ?? (() => Date.now()),
  };
  const lock: GitIndexLock = { readers: 0, writer: false, waiters: [] };
  const sshCommandCache = new Map<string, Promise<boolean | null>>();

  /**
   * Resolves whether the user configured an SSH command for one working directory.
   *
   * Only a conclusive answer is cached. A cancelled, timed-out, or failed probe resolves to
   * `false` for the current invocation without poisoning later invocations, which retry the probe.
   *
   * @param cwd - Working directory of the invocation.
   * @param signal - Cancellation signal.
   * @returns True when a user-configured SSH command must be preserved.
   */
  async function resolveSshCommandConfigured(cwd: string, signal: AbortSignal): Promise<boolean> {
    if (resolveSshOverride !== undefined) {
      return resolveSshOverride(cwd, signal);
    }

    if ((baseEnv.GIT_SSH_COMMAND ?? "").trim().length > 0) {
      return true;
    }

    const cached = sshCommandCache.get(cwd);

    if (cached !== undefined) {
      return (await cached) ?? false;
    }

    const pending = detectCoreSshCommand(cwd, signal);
    sshCommandCache.set(cwd, pending);

    void pending.then((value) => {
      if (value === null && sshCommandCache.get(cwd) === pending) {
        sshCommandCache.delete(cwd);
      }
    });

    return (await pending) ?? false;
  }

  /**
   * Asks git for the repository or global `core.sshCommand` setting.
   *
   * Only a conclusive answer is returned. A cancelled, timed-out, spawn-failed, or generic git
   * failure resolves null so the caller retries instead of caching a false answer that would
   * override a configured SSH command. Git reports a missing key with exit code 1 and empty
   * stderr, which is the one non-zero answer that is conclusive.
   *
   * @param cwd - Working directory of the invocation.
   * @param signal - Cancellation signal.
   * @returns True when the setting is non-empty, false when it is conclusively empty, null when the
   * probe was cancelled, timed out, or could not answer.
   */
  async function detectCoreSshCommand(cwd: string, signal: AbortSignal): Promise<boolean | null> {
    const result = await executeInvocation(
      {
        args: ["config", "--get", "core.sshCommand"],
        cwd,
        signal,
        operationClass: "read",
        sshCommandConfigured: true,
      },
      true,
    );

    if (result.cancelled || result.timedOut || result.spawnError !== null) {
      return null;
    }

    if (result.ok) {
      return result.stdout.trim().length > 0;
    }

    return result.exitCode === 1 && result.stderr.trim().length === 0 ? false : null;
  }

  /**
   * Executes one invocation with the client settings.
   *
   * @param invokeOptions - Caller options.
   * @param sshCommandConfigured - Resolved SSH configuration flag.
   * @returns The settled invocation result.
   */
  async function executeInvocation(
    invokeOptions: GitInvokeOptions,
    sshCommandConfigured: boolean,
  ): Promise<GitInvocationResult> {
    const timeoutMs =
      invokeOptions.timeoutMs ??
      resolveOperationTimeout(invokeOptions.operationClass, timeoutOverrides);
    const env = buildGitEnvironment(baseEnv, sshCommandConfigured);

    return await spawnAndCollect(spawnProcess, gitPath, invokeOptions, env, timeoutMs, settings);
  }

  return {
    gitPath,

    /**
     * Runs one git invocation through the index lock and the spawn contract.
     *
     * @param invokeOptions - Arguments, working directory, operation class, and signal.
     * @returns The settled invocation result.
     */
    async invoke(invokeOptions) {
      const lane = resolveInvocationLane(invokeOptions);
      const startedAt = settings.now();
      const release =
        lane === "plain"
          ? null
          : await acquireIndexLock(lock, lane === "write", invokeOptions.signal);

      if (lane !== "plain" && release === null) {
        return createCancelledResult(invokeOptions, settings.now() - startedAt, gitPath);
      }

      try {
        const sshCommandConfigured =
          invokeOptions.sshCommandConfigured ??
          (await resolveSshCommandConfigured(invokeOptions.cwd, invokeOptions.signal));

        if (invokeOptions.signal.aborted) {
          return createCancelledResult(invokeOptions, settings.now() - startedAt, gitPath);
        }

        return await executeInvocation(invokeOptions, sshCommandConfigured);
      } finally {
        release?.();
      }
    },
  };
}

/**
 * Selects the serialization lane for one invocation.
 *
 * Writes are exclusive. Reads that touch the index (`status`, `diff`, and `log --raw`) share a lane
 * that excludes writers. Every other read and every network operation runs without the lock.
 *
 * @param options - Invocation options.
 * @returns The lane the invocation must run in.
 */
function resolveInvocationLane(options: {
  readonly args: readonly string[];
  readonly operationClass: GitOperationClass;
  readonly touchesIndex?: boolean;
}): GitInvocationLane {
  if (options.operationClass === "write") {
    return "write";
  }

  if (options.touchesIndex === true) {
    return "index-read";
  }

  if (options.touchesIndex === false) {
    return "plain";
  }

  const command = options.args[0];

  if (command !== undefined && INDEX_READ_COMMANDS.has(command)) {
    return "index-read";
  }

  if (command === "log" && options.args.includes("--raw")) {
    return "index-read";
  }

  return "plain";
}

/**
 * Acquires the index lock in shared or exclusive mode.
 *
 * Waiting is abort-aware: an abort while queued removes the waiter and resolves null, so a
 * cancelled read never starts after a long write finishes.
 *
 * @param lock - The client's index lock.
 * @param exclusive - True for a write, false for an index-touching read.
 * @param signal - Cancellation signal.
 * @returns A release function, or null when the signal aborted while waiting.
 */
async function acquireIndexLock(
  lock: GitIndexLock,
  exclusive: boolean,
  signal: AbortSignal,
): Promise<(() => void) | null> {
  if (signal.aborted) {
    return null;
  }

  if (canGrantLock(lock, exclusive)) {
    applyLockGrant(lock, exclusive);

    return createLockRelease(lock, exclusive);
  }

  return await new Promise<(() => void) | null>((resolve) => {
    const onAbort = (): void => {
      const index = lock.waiters.indexOf(waiter);

      if (index >= 0) {
        lock.waiters.splice(index, 1);
      }

      signal.removeEventListener("abort", onAbort);
      resolve(null);
    };

    const waiter: GitIndexLockWaiter = {
      exclusive,
      grant: () => {
        signal.removeEventListener("abort", onAbort);
        resolve(createLockRelease(lock, exclusive));
      },
    };

    signal.addEventListener("abort", onAbort, { once: true });
    lock.waiters.push(waiter);
  });
}

/**
 * Reports whether the lock can grant the requested mode immediately.
 *
 * @param lock - The client's index lock.
 * @param exclusive - True for exclusive access.
 * @returns True when the grant would not violate the latch.
 */
function canGrantLock(lock: GitIndexLock, exclusive: boolean): boolean {
  if (exclusive) {
    return !lock.writer && lock.readers === 0;
  }

  return !lock.writer && lock.waiters.length === 0;
}

/**
 * Applies one grant to the lock counters.
 *
 * @param lock - The client's index lock.
 * @param exclusive - True for exclusive access.
 */
function applyLockGrant(lock: GitIndexLock, exclusive: boolean): void {
  if (exclusive) {
    lock.writer = true;

    return;
  }

  lock.readers += 1;
}

/**
 * Creates the release function for one grant.
 *
 * @param lock - The client's index lock.
 * @param exclusive - True when the grant was exclusive.
 * @returns A function that releases the grant and drains waiting work.
 */
function createLockRelease(lock: GitIndexLock, exclusive: boolean): () => void {
  let released = false;

  return () => {
    if (released) {
      return;
    }

    released = true;

    if (exclusive) {
      lock.writer = false;
    } else {
      lock.readers -= 1;
    }

    drainLockWaiters(lock);
  };
}

/**
 * Grants queued work in arrival order without breaking the read-write latch.
 *
 * Consecutive shared waiters are granted together. An exclusive waiter waits for every active
 * reader and is never bypassed by a later shared waiter.
 *
 * @param lock - The client's index lock.
 */
function drainLockWaiters(lock: GitIndexLock): void {
  while (lock.waiters.length > 0 && !lock.writer) {
    const first = lock.waiters[0];

    if (first === undefined) {
      return;
    }

    if (first.exclusive) {
      if (lock.readers > 0) {
        return;
      }

      lock.waiters.shift();
      applyLockGrant(lock, true);
      first.grant();

      return;
    }

    while (lock.waiters.length > 0) {
      const next = lock.waiters[0];

      if (next === undefined || next.exclusive) {
        break;
      }

      lock.waiters.shift();
      applyLockGrant(lock, false);
      next.grant();
    }
  }
}

/**
 * Builds the result of an invocation that was cancelled before it could spawn.
 *
 * @param options - Invocation options.
 * @param elapsedMs - Time spent waiting before the attempt ended.
 * @param gitPath - Git executable the invocation would have used.
 * @returns A cancelled result that is never successful.
 */
function createCancelledResult(
  options: {
    readonly args: readonly string[];
    readonly cwd: string;
    readonly operationClass: GitOperationClass;
  },
  elapsedMs: number,
  gitPath: string,
): GitInvocationResult {
  return {
    argv: [gitPath, ...options.args],
    cwd: options.cwd,
    exitCode: null,
    terminationSignal: null,
    stdout: "",
    stderr: "",
    durationMs: Math.max(0, elapsedMs),
    cancelled: true,
    timedOut: false,
    timedOutAfterMs: null,
    spawnError: null,
    ok: false,
  };
}

/**
 * Spawns the child and resolves when it exits, times out, or is aborted.
 *
 * Abort and timeout share the documented termination path: send `SIGTERM`, wait the grace period,
 * then send `SIGKILL`. A terminated child settles on its `exit` event, because a descendant can
 * keep the output pipes open after the child is gone. A normal exit waits for `close` so every
 * buffered chunk is captured, but only for the bounded exit flush grace: if a backgrounded
 * descendant holds the pipes open, the invocation still settles with the captured output instead of
 * waiting for that descendant's lifetime. The invocation timeout is cleared once a normal exit is
 * recorded, so a late timeout or abort cannot rewrite a completed command as timed out or cancelled.
 *
 * @param spawnProcess - Injectable spawner.
 * @param gitPath - Git executable.
 * @param options - Invocation options.
 * @param env - Fully merged child environment.
 * @param timeoutMs - Timeout for this invocation.
 * @param settings - Runtime timing and output limits.
 * @returns The settled invocation result.
 */
async function spawnAndCollect(
  spawnProcess: GitSpawn,
  gitPath: string,
  options: {
    readonly args: readonly string[];
    readonly cwd: string;
    readonly signal: AbortSignal;
    readonly onStdout?: (chunk: string) => void;
    readonly onStderr?: (chunk: string) => void;
  },
  env: Record<string, string>,
  timeoutMs: number,
  settings: GitExecutionSettings,
): Promise<GitInvocationResult> {
  const startedAt = settings.now();
  const argv = [gitPath, ...options.args];
  const stdout = createOutputCollector(settings.outputLimitCharacters);
  const stderr = createOutputCollector(settings.outputLimitCharacters);

  return await new Promise<GitInvocationResult>((resolve) => {
    let child: GitSpawnedProcess | null = null;
    let settled = false;
    let cancelled = false;
    let timedOut = false;
    let spawnError: GitSpawnFailure | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    let killTimer: ReturnType<typeof setTimeout> | null = null;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let exited = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;

    const cleanup = (): void => {
      if (timeoutTimer !== null) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }

      if (killTimer !== null) {
        clearTimeout(killTimer);
        killTimer = null;
      }

      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }

      options.signal.removeEventListener("abort", onAbort);
    };

    const settle = (code: number | null, terminationSignal: NodeJS.Signals | null): void => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve({
        argv,
        cwd: options.cwd,
        exitCode: code,
        terminationSignal,
        stdout: stdout.read(),
        stderr: stderr.read(),
        durationMs: Math.max(0, settings.now() - startedAt),
        cancelled,
        timedOut,
        timedOutAfterMs: timedOut ? timeoutMs : null,
        spawnError,
        ok: code === 0 && !cancelled && !timedOut && spawnError === null,
      });
    };

    const terminate = (fromTimeout: boolean): void => {
      if (settled || child === null) {
        return;
      }

      // A normal exit is already the truthful result. A timeout or abort that lands during the
      // post-exit flush grace must not rewrite a completed command as timed out or cancelled.
      if (exited) {
        settle(exitCode, exitSignal);

        return;
      }

      if (fromTimeout) {
        timedOut = true;
      } else {
        cancelled = true;
      }

      if (timeoutTimer !== null) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }

      try {
        child.kill("SIGTERM");
      } catch {
        // The child may already be gone; the close event still settles the invocation.
      }

      if (killTimer === null) {
        killTimer = setTimeout(() => {
          try {
            child?.kill("SIGKILL");
          } catch {
            // A child that exited between the grace period and this call needs no signal.
          }
        }, settings.killGraceMs);
      }
    };

    const onAbort = (): void => terminate(false);

    const spawnOptions: GitSpawnOptions = {
      cwd: options.cwd,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    };

    try {
      child = spawnProcess(gitPath, options.args, spawnOptions);
    } catch (error) {
      spawnError = readSpawnFailure(error);
      settle(null, null);

      return;
    }

    attachStream(child.stdout, (text) => {
      stdout.push(text);
      options.onStdout?.(text);
    });
    attachStream(child.stderr, (text) => {
      stderr.push(text);
      options.onStderr?.(text);
    });

    child.on("error", (error) => {
      spawnError = readSpawnFailure(error);
      settle(null, null);
    });

    child.on("exit", (code, terminationSignal) => {
      exited = true;
      exitCode = code;
      exitSignal = terminationSignal;

      // A terminated child can leave descendant processes holding the output pipes open. Settle
      // immediately in that case so an orphan cannot delay the result. A normal exit waits for the
      // close event during a bounded flush grace so buffered chunks are captured, then settles even
      // if a descendant keeps the pipes open. The invocation timeout is cleared here because the
      // flush grace already bounds settlement; a timeout firing after the child finished must not
      // turn a successful command into a timeout.
      if (cancelled || timedOut) {
        settle(code, terminationSignal);

        return;
      }

      if (timeoutTimer !== null) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }

      if (flushTimer === null) {
        flushTimer = setTimeout(() => {
          flushTimer = null;
          settle(exitCode, exitSignal);
        }, settings.exitFlushGraceMs);
      }
    });

    child.on("close", (code, terminationSignal) => {
      settle(code, terminationSignal);
    });

    if (options.signal.aborted) {
      terminate(false);
    } else {
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    timeoutTimer = setTimeout(() => terminate(true), timeoutMs);
  });
}

/**
 * Subscribes to a child stream and decodes each chunk to text.
 *
 * @param stream - Child stream, or null when the spawn failed.
 * @param onText - Receives each decoded chunk.
 */
function attachStream(stream: GitReadableStream | null, onText: (text: string) => void): void {
  if (stream === null) {
    return;
  }

  stream.on("data", (chunk) => {
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");

    if (text.length > 0) {
      onText(text);
    }
  });
}

/**
 * Converts a thrown or emitted spawn error into the result shape.
 *
 * @param error - Error reported by the spawner.
 * @returns The spawn failure with a platform code when one was reported.
 */
function readSpawnFailure(error: unknown): GitSpawnFailure {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code ?? null;

    return { code, message: error.message };
  }

  return { code: null, message: String(error) };
}

/**
 * Creates a bounded text collector that keeps the head and the tail of a stream.
 *
 * Head and tail are both preserved because the first line usually names the failing command while
 * the last lines carry the decisive git error.
 *
 * @param limitCharacters - Maximum characters kept, split between head and tail.
 * @returns A collector with `push` and `read`.
 */
function createOutputCollector(limitCharacters: number): {
  push(text: string): void;
  read(): string;
} {
  const halfLimit = Math.max(1, Math.floor(limitCharacters / 2));
  let head = "";
  let tail = "";
  let truncated = false;

  return {
    push(text: string): void {
      if (text.length === 0) {
        return;
      }

      if (truncated) {
        tail = appendTail(tail, text, halfLimit);

        return;
      }

      if (head.length + text.length <= halfLimit) {
        head += text;

        return;
      }

      const consumed = Math.max(0, halfLimit - head.length);
      const remainder = text.slice(consumed);

      head += text.slice(0, consumed);
      truncated = true;
      tail = appendTail(tail, remainder, halfLimit);
    },

    read(): string {
      return truncated ? `${head}${OUTPUT_TRUNCATION_MARKER}${tail}` : head;
    },
  };
}

/**
 * Appends text to a bounded tail buffer.
 *
 * @param tail - Current tail buffer.
 * @param text - Text to append.
 * @param limit - Maximum tail length.
 * @returns The tail trimmed to its most recent characters.
 */
function appendTail(tail: string, text: string, limit: number): string {
  const combined = tail + text;

  return combined.length > limit ? combined.slice(combined.length - limit) : combined;
}

/**
 * Spawns a process with the production `node:child_process` implementation.
 *
 * @param command - Executable to run.
 * @param args - Argument array.
 * @param options - Working directory, environment, and fixed stdio.
 * @returns The child process behind the narrow client contract.
 */
function defaultSpawn(
  command: string,
  args: readonly string[],
  options: GitSpawnOptions,
): GitSpawnedProcess {
  const child = spawn(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  return child as unknown as GitSpawnedProcess;
}
