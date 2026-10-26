import { describe, expect, it } from "bun:test";
import {
  buildGitEnvironment,
  createGitClient,
  DEFAULT_GIT_TIMEOUTS,
  GIT_ENVIRONMENT_MATRIX,
  resolveOperationTimeout,
} from "@/domain/git/git.client";
import type { GitSpawn, GitSpawnedProcess, GitSpawnOptions } from "@/domain/git/git.types";

/** Listener type for fake stdout and stderr streams. */
type DataListener = (chunk: Uint8Array | string) => void;

/** Fake child process that records signals and exposes manual lifecycle control. */
class FakeChild {
  /** Registered stdout listeners. */
  readonly stdoutListeners: DataListener[] = [];
  /** Registered stderr listeners. */
  readonly stderrListeners: DataListener[] = [];
  /** Registered error listeners. */
  readonly errorListeners: Array<(error: NodeJS.ErrnoException) => void> = [];
  /** Registered close listeners. */
  readonly closeListeners: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = [];
  /** Registered exit listeners. */
  readonly exitListeners: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = [];
  /** Signals delivered to this child. */
  readonly killed: NodeJS.Signals[] = [];

  /**
   * Creates a fake child.
   *
   * @param ignoreSigterm - When true, `SIGTERM` does not close the child.
   */
  constructor(private readonly ignoreSigterm: boolean = false) {}

  /** Fake stdout stream. */
  readonly stdout = {
    /**
     * Registers a data listener.
     *
     * @param _event - Always `data`.
     * @param listener - Chunk listener.
     */
    on: (_event: "data", listener: DataListener): void => {
      this.stdoutListeners.push(listener);
    },
  };

  /** Fake stderr stream. */
  readonly stderr = {
    /**
     * Registers a data listener.
     *
     * @param _event - Always `data`.
     * @param listener - Chunk listener.
     */
    on: (_event: "data", listener: DataListener): void => {
      this.stderrListeners.push(listener);
    },
  };

  /**
   * Registers a lifecycle listener.
   *
   * @param event - `error`, `exit`, or `close`.
   * @param listener - Listener.
   */
  on(
    event: "error" | "close" | "exit",
    listener:
      | ((error: NodeJS.ErrnoException) => void)
      | ((code: number | null, signal: NodeJS.Signals | null) => void),
  ): void {
    if (event === "error") {
      this.errorListeners.push(listener as (error: NodeJS.ErrnoException) => void);

      return;
    }

    const exitListener = listener as (code: number | null, signal: NodeJS.Signals | null) => void;

    if (event === "exit") {
      this.exitListeners.push(exitListener);

      return;
    }

    this.closeListeners.push(exitListener);
  }

  /**
   * Delivers a signal to the fake child.
   *
   * @param signal - Signal name.
   * @returns Always true.
   */
  kill(signal: NodeJS.Signals): boolean {
    this.killed.push(signal);

    if (signal === "SIGTERM" && !this.ignoreSigterm) {
      queueMicrotask(() => this.close(143, "SIGTERM"));
    }

    if (signal === "SIGKILL") {
      queueMicrotask(() => this.close(null, "SIGKILL"));
    }

    return true;
  }

  /**
   * Emits stdout text.
   *
   * @param text - Text chunk.
   */
  emitStdout(text: string): void {
    for (const listener of this.stdoutListeners) {
      listener(text);
    }
  }

  /**
   * Emits stderr text.
   *
   * @param text - Text chunk.
   */
  emitStderr(text: string): void {
    for (const listener of this.stderrListeners) {
      listener(text);
    }
  }

  /**
   * Emits a spawn error.
   *
   * @param error - Error to deliver.
   */
  fail(error: NodeJS.ErrnoException): void {
    for (const listener of this.errorListeners) {
      listener(error);
    }
  }

  /**
   * Emits only the exit event, leaving the close event withheld.
   *
   * A real child emits `exit` before `close`; a descendant can delay `close` indefinitely. Tests use
   * this to model an exit that lands inside the post-exit flush grace.
   *
   * @param code - Exit code.
   * @param signal - Terminating signal.
   */
  exit(code: number | null, signal: NodeJS.Signals | null): void {
    for (const listener of this.exitListeners) {
      listener(code, signal);
    }
  }

  /**
   * Emits the close event.
   *
   * @param code - Exit code.
   * @param signal - Terminating signal.
   */
  close(code: number | null, signal: NodeJS.Signals | null): void {
    for (const listener of this.exitListeners) {
      listener(code, signal);
    }

    for (const listener of this.closeListeners) {
      listener(code, signal);
    }
  }
}

/** One recorded spawn call. */
interface SpawnRecord {
  /** Command passed to the spawner. */
  readonly command: string;
  /** Argument array passed to the spawner. */
  readonly args: readonly string[];
  /** Options passed to the spawner. */
  readonly options: GitSpawnOptions;
  /** Fake child returned to the client. */
  readonly child: FakeChild;
}

/**
 * Builds a spawn seam that records calls and returns controllable children.
 *
 * @param ignoreSigterm - When true, every child ignores `SIGTERM`.
 * @returns The spawn function and its recorded calls.
 */
function createFakeSpawn(ignoreSigterm: boolean = false): {
  spawn: GitSpawn;
  records: SpawnRecord[];
} {
  const records: SpawnRecord[] = [];
  const spawn: GitSpawn = (command, args, options) => {
    const child = new FakeChild(ignoreSigterm);
    records.push({ command, args: [...args], options, child });

    return child as unknown as GitSpawnedProcess;
  };

  return { spawn, records };
}

/**
 * Waits for a condition to become true.
 *
 * @param predicate - Condition to poll.
 * @param timeoutMs - Maximum wait.
 */
async function waitFor(predicate: () => boolean, timeoutMs: number = 500): Promise<void> {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("condition was not met in time");
    }

    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

/**
 * Builds a client with test-friendly timing that never probes the SSH configuration.
 *
 * @param spawn - Fake spawner.
 * @param options - Extra client options.
 * @returns The test client.
 */
function createTestClient(
  spawn: GitSpawn,
  options: {
    readonly killGraceMs?: number;
    readonly outputLimitCharacters?: number;
    readonly baseEnv?: Readonly<Record<string, string | undefined>>;
  } = {},
) {
  return createGitClient({
    gitPath: "git-test",
    spawn,
    baseEnv: options.baseEnv ?? {},
    killGraceMs: options.killGraceMs ?? 5,
    outputLimitCharacters: options.outputLimitCharacters,
    resolveSshCommandConfigured: async () => false,
  });
}

describe("buildGitEnvironment", () => {
  it("applies the full prompt, editor, and pager matrix", () => {
    const env = buildGitEnvironment({ PATH: "/usr/bin" }, false);

    expect(env.PATH).toBe("/usr/bin");

    for (const [key, value] of Object.entries(GIT_ENVIRONMENT_MATRIX)) {
      expect(env[key]).toBe(value);
    }
  });

  it("adds the batch-mode SSH command only when the user configured none", () => {
    expect(buildGitEnvironment({}, false).GIT_SSH_COMMAND).toBe("ssh -o BatchMode=yes");
    expect(buildGitEnvironment({}, true).GIT_SSH_COMMAND).toBeUndefined();
  });

  it("keeps a user-configured SSH command", () => {
    const env = buildGitEnvironment({ GIT_SSH_COMMAND: "ssh -i key" }, true);

    expect(env.GIT_SSH_COMMAND).toBe("ssh -i key");
  });

  it("drops undefined environment values", () => {
    const env = buildGitEnvironment({ EMPTY: undefined }, false);

    expect(Object.hasOwn(env, "EMPTY")).toBeFalse();
  });
});

describe("resolveOperationTimeout", () => {
  it("uses the documented class defaults", () => {
    expect(resolveOperationTimeout("read")).toBe(DEFAULT_GIT_TIMEOUTS.read);
    expect(resolveOperationTimeout("write")).toBe(DEFAULT_GIT_TIMEOUTS.write);
    expect(resolveOperationTimeout("network")).toBe(DEFAULT_GIT_TIMEOUTS.network);
    expect(DEFAULT_GIT_TIMEOUTS).toEqual({ read: 10_000, write: 30_000, network: 120_000 });
  });

  it("honors per-class overrides", () => {
    expect(resolveOperationTimeout("network", { network: 5_000 })).toBe(5_000);
    expect(resolveOperationTimeout("read", { network: 5_000 })).toBe(10_000);
  });
});

describe("git client invocation", () => {
  it("executes the configured path with an argument array, no shell, and fixed stdio", async () => {
    const { spawn, records } = createFakeSpawn();
    const client = createTestClient(spawn);
    const promise = client.invoke({
      args: ["status", "--porcelain=v2"],
      cwd: "/repo",
      signal: new AbortController().signal,
      operationClass: "read",
      sshCommandConfigured: true,
    });

    await waitFor(() => records.length === 1);

    const record = records[0];
    expect(record?.command).toBe("git-test");
    expect(record?.args).toEqual(["status", "--porcelain=v2"]);
    expect(record?.options.cwd).toBe("/repo");
    expect(record?.options.shell).toBeFalse();
    expect(record?.options.stdio).toEqual(["ignore", "pipe", "pipe"]);

    record?.child.close(0, null);
    const result = await promise;

    expect(result.ok).toBeTrue();
    expect(result.argv).toEqual(["git-test", "status", "--porcelain=v2"]);
  });

  it("passes the merged environment to the child", async () => {
    const { spawn, records } = createFakeSpawn();
    const client = createTestClient(spawn, { baseEnv: { PATH: "/bin", TERM: "xterm" } });
    const promise = client.invoke({
      args: ["rev-parse", "HEAD"],
      cwd: "/repo",
      signal: new AbortController().signal,
      operationClass: "read",
      sshCommandConfigured: false,
    });

    await waitFor(() => records.length === 1);

    expect(records[0]?.options.env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(records[0]?.options.env.LC_ALL).toBe("C");
    expect(records[0]?.options.env.GIT_SSH_COMMAND).toBe("ssh -o BatchMode=yes");
    expect(records[0]?.options.env.PATH).toBe("/bin");

    records[0]?.child.close(0, null);
    await promise;
  });

  it("omits the default SSH command when the user configured one", async () => {
    const { spawn, records } = createFakeSpawn();
    const client = createTestClient(spawn);
    const promise = client.invoke({
      args: ["fetch", "origin"],
      cwd: "/repo",
      signal: new AbortController().signal,
      operationClass: "network",
      sshCommandConfigured: true,
    });

    await waitFor(() => records.length === 1);

    expect(records[0]?.options.env.GIT_SSH_COMMAND).toBeUndefined();

    records[0]?.child.close(0, null);
    await promise;
  });

  it("reads core.sshCommand once per working directory", async () => {
    const { spawn, records } = createFakeSpawn();
    const client = createGitClient({
      gitPath: "git-test",
      spawn,
      baseEnv: {},
      killGraceMs: 5,
    });
    const first = client.invoke({
      args: ["fetch", "origin"],
      cwd: "/repo",
      signal: new AbortController().signal,
      operationClass: "network",
    });

    await waitFor(() => records.length === 1);
    expect(records[0]?.args).toEqual(["config", "--get", "core.sshCommand"]);

    records[0]?.child.emitStdout("ssh -i /keys/id\n");
    records[0]?.child.close(0, null);
    await waitFor(() => records.length === 2);

    expect(records[1]?.args).toEqual(["fetch", "origin"]);
    expect(records[1]?.options.env.GIT_SSH_COMMAND).toBeUndefined();

    records[1]?.child.close(0, null);
    await first;

    const second = client.invoke({
      args: ["push", "origin"],
      cwd: "/repo",
      signal: new AbortController().signal,
      operationClass: "network",
    });

    await waitFor(() => records.length === 3);
    expect(records[2]?.args).toEqual(["push", "origin"]);

    records[2]?.child.close(0, null);
    await second;
  });

  it("retries an inconclusive core.sshCommand probe instead of caching it", async () => {
    const { spawn, records } = createFakeSpawn();
    const client = createGitClient({
      gitPath: "git-test",
      spawn,
      baseEnv: {},
      killGraceMs: 5,
    });
    const controller = new AbortController();
    const first = client.invoke({
      args: ["status"],
      cwd: "/repo",
      signal: controller.signal,
      operationClass: "read",
    });

    await waitFor(() => records.length === 1);
    expect(records[0]?.args).toEqual(["config", "--get", "core.sshCommand"]);

    controller.abort();
    await first;

    const second = client.invoke({
      args: ["status"],
      cwd: "/repo",
      signal: new AbortController().signal,
      operationClass: "read",
    });

    await waitFor(() => records.length === 2);
    expect(records[1]?.args).toEqual(["config", "--get", "core.sshCommand"]);

    records[1]?.child.emitStdout("ssh -i /keys/id\n");
    records[1]?.child.close(0, null);
    await waitFor(() => records.length === 3);

    expect(records[2]?.args).toEqual(["status"]);
    expect(records[2]?.options.env.GIT_SSH_COMMAND).toBeUndefined();

    records[2]?.child.close(0, null);
    await second;
  });

  it("retries after a generic core.sshCommand failure instead of caching false", async () => {
    const { spawn, records } = createFakeSpawn();
    const client = createGitClient({
      gitPath: "git-test",
      spawn,
      baseEnv: {},
      killGraceMs: 5,
    });
    const first = client.invoke({
      args: ["status"],
      cwd: "/repo",
      signal: new AbortController().signal,
      operationClass: "read",
    });

    await waitFor(() => records.length === 1);
    expect(records[0]?.args).toEqual(["config", "--get", "core.sshCommand"]);

    records[0]?.child.emitStderr("fatal: unable to read config file\n");
    records[0]?.child.close(1, null);
    await waitFor(() => records.length === 2);
    expect(records[1]?.args).toEqual(["status"]);

    records[1]?.child.close(0, null);
    await first;

    const second = client.invoke({
      args: ["status"],
      cwd: "/repo",
      signal: new AbortController().signal,
      operationClass: "read",
    });

    await waitFor(() => records.length === 3);
    expect(records[2]?.args).toEqual(["config", "--get", "core.sshCommand"]);

    records[2]?.child.emitStdout("ssh -i /keys/id\n");
    records[2]?.child.close(0, null);
    await waitFor(() => records.length === 4);

    expect(records[3]?.args).toEqual(["status"]);
    expect(records[3]?.options.env.GIT_SSH_COMMAND).toBeUndefined();

    records[3]?.child.close(0, null);
    await second;
  });

  it("reports a missing executable as a spawn failure", async () => {
    const { spawn, records } = createFakeSpawn();
    const client = createTestClient(spawn);
    const promise = client.invoke({
      args: ["status"],
      cwd: "/repo",
      signal: new AbortController().signal,
      operationClass: "read",
      sshCommandConfigured: true,
    });

    await waitFor(() => records.length === 1);

    const error = Object.assign(new Error("spawn git-test ENOENT"), { code: "ENOENT" });
    records[0]?.child.fail(error);
    const result = await promise;

    expect(result.ok).toBeFalse();
    expect(result.spawnError?.code).toBe("ENOENT");
    expect(result.exitCode).toBeNull();
  });

  it("collects stdout and stderr", async () => {
    const { spawn, records } = createFakeSpawn();
    const client = createTestClient(spawn);
    const chunks: string[] = [];
    const promise = client.invoke({
      args: ["status"],
      cwd: "/repo",
      signal: new AbortController().signal,
      operationClass: "read",
      sshCommandConfigured: true,
      onStdout: (chunk) => chunks.push(chunk),
    });

    await waitFor(() => records.length === 1);

    records[0]?.child.emitStdout("line one\n");
    records[0]?.child.emitStderr("warning\n");
    records[0]?.child.close(0, null);
    const result = await promise;

    expect(chunks).toEqual(["line one\n"]);
    expect(result.stdout).toBe("line one\n");
    expect(result.stderr).toBe("warning\n");
    expect(result.ok).toBeTrue();
  });

  it("bounds captured output while keeping head and tail", async () => {
    const { spawn, records } = createFakeSpawn();
    const client = createTestClient(spawn, { outputLimitCharacters: 10 });
    const promise = client.invoke({
      args: ["status"],
      cwd: "/repo",
      signal: new AbortController().signal,
      operationClass: "read",
      sshCommandConfigured: true,
    });

    await waitFor(() => records.length === 1);

    records[0]?.child.emitStdout("0123456789ABCDEF");
    records[0]?.child.close(0, null);
    const result = await promise;

    expect(result.stdout).toBe("01234\n[output truncated]\nBCDEF");
    expect(result.stdoutTruncated).toBeTrue();
    expect(result.stderrTruncated).toBeUndefined();
  });

  it("reports a truncated stderr stream without changing the text", async () => {
    const { spawn, records } = createFakeSpawn();
    const client = createTestClient(spawn, { outputLimitCharacters: 10 });
    const promise = client.invoke({
      args: ["status"],
      cwd: "/repo",
      signal: new AbortController().signal,
      operationClass: "read",
      sshCommandConfigured: true,
    });

    await waitFor(() => records.length === 1);

    records[0]?.child.emitStderr("0123456789ABCDEF");
    records[0]?.child.close(0, null);
    const result = await promise;

    expect(result.stderr).toBe("01234\n[output truncated]\nBCDEF");
    expect(result.stderrTruncated).toBeTrue();
    expect(result.stdoutTruncated).toBeUndefined();
  });

  it("keeps a stream that fits the capture limit without marking it truncated", async () => {
    const { spawn, records } = createFakeSpawn();
    const client = createTestClient(spawn, { outputLimitCharacters: 10 });
    const promise = client.invoke({
      args: ["status"],
      cwd: "/repo",
      signal: new AbortController().signal,
      operationClass: "read",
      sshCommandConfigured: true,
    });

    await waitFor(() => records.length === 1);

    records[0]?.child.emitStdout("ABCDEFG");
    records[0]?.child.close(0, null);
    const result = await promise;

    expect(result.stdout).toBe("ABCDEFG");
    expect(result.stdoutTruncated).toBeUndefined();
  });

  it("captures exactly the limit across the head and the tail", async () => {
    const { spawn, records } = createFakeSpawn();
    const client = createTestClient(spawn, { outputLimitCharacters: 10 });
    const promise = client.invoke({
      args: ["status"],
      cwd: "/repo",
      signal: new AbortController().signal,
      operationClass: "read",
      sshCommandConfigured: true,
    });

    await waitFor(() => records.length === 1);

    records[0]?.child.emitStdout("0123456789");
    records[0]?.child.close(0, null);
    const result = await promise;

    expect(result.stdout).toBe("0123456789");
    expect(result.stdoutTruncated).toBeUndefined();
  });

  it("marks a stream truncated only when the middle is dropped", async () => {
    const { spawn, records } = createFakeSpawn();
    const client = createTestClient(spawn, { outputLimitCharacters: 10 });
    const promise = client.invoke({
      args: ["status"],
      cwd: "/repo",
      signal: new AbortController().signal,
      operationClass: "read",
      sshCommandConfigured: true,
    });

    await waitFor(() => records.length === 1);

    records[0]?.child.emitStdout("0123456789A");
    records[0]?.child.close(0, null);
    const result = await promise;

    expect(result.stdout).toBe("01234\n[output truncated]\n6789A");
    expect(result.stdoutTruncated).toBeTrue();
  });
});

describe("git client cancellation and timeouts", () => {
  it("cancels through SIGTERM then SIGKILL after the grace period", async () => {
    const { spawn, records } = createFakeSpawn(true);
    const client = createTestClient(spawn, { killGraceMs: 5 });
    const controller = new AbortController();
    const promise = client.invoke({
      args: ["fetch", "origin"],
      cwd: "/repo",
      signal: controller.signal,
      operationClass: "network",
      sshCommandConfigured: true,
    });

    await waitFor(() => records.length === 1);
    controller.abort();
    const result = await promise;

    expect(result.cancelled).toBeTrue();
    expect(result.timedOut).toBeFalse();
    expect(result.ok).toBeFalse();
    expect(records[0]?.child.killed).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("returns a distinct timed-out result after the escalation path", async () => {
    const { spawn, records } = createFakeSpawn(true);
    const client = createTestClient(spawn, { killGraceMs: 5 });
    const promise = client.invoke({
      args: ["status"],
      cwd: "/repo",
      signal: new AbortController().signal,
      operationClass: "read",
      timeoutMs: 10,
      sshCommandConfigured: true,
    });

    await waitFor(() => records.length === 1);
    const result = await promise;

    expect(result.timedOut).toBeTrue();
    expect(result.cancelled).toBeFalse();
    expect(result.timedOutAfterMs).toBe(10);
    expect(result.ok).toBeFalse();
    expect(records[0]?.child.killed).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("keeps a normal exit successful when the timeout would land in the flush grace", async () => {
    const { spawn, records } = createFakeSpawn();
    const client = createTestClient(spawn);
    const promise = client.invoke({
      args: ["status"],
      cwd: "/repo",
      signal: new AbortController().signal,
      operationClass: "read",
      timeoutMs: 100,
      sshCommandConfigured: true,
    });

    await waitFor(() => records.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    records[0]?.child.exit(0, null);

    const result = await promise;

    expect(result.ok).toBeTrue();
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBeFalse();
    expect(result.cancelled).toBeFalse();
    expect(records[0]?.child.killed).toEqual([]);
  });

  it("does not spawn when the signal is already aborted", async () => {
    const { spawn, records } = createFakeSpawn();
    const client = createTestClient(spawn);
    const controller = new AbortController();
    controller.abort();

    const result = await client.invoke({
      args: ["status"],
      cwd: "/repo",
      signal: controller.signal,
      operationClass: "read",
      sshCommandConfigured: true,
    });

    expect(records).toHaveLength(0);
    expect(result.cancelled).toBeTrue();
    expect(result.ok).toBeFalse();
  });
});

describe("git client serialization", () => {
  it("waits for an index-touching read while a write is running", async () => {
    const { spawn, records } = createFakeSpawn();
    const client = createTestClient(spawn);
    const write = client.invoke({
      args: ["commit", "-m", "message"],
      cwd: "/repo",
      signal: new AbortController().signal,
      operationClass: "write",
      sshCommandConfigured: true,
    });

    await waitFor(() => records.length === 1);

    const read = client.invoke({
      args: ["status"],
      cwd: "/repo",
      signal: new AbortController().signal,
      operationClass: "read",
      sshCommandConfigured: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(records).toHaveLength(1);

    records[0]?.child.close(0, null);
    await waitFor(() => records.length === 2);

    records[1]?.child.close(0, null);
    await Promise.all([write, read]);

    expect(records.map((record) => record.args[0])).toEqual(["commit", "status"]);
  });

  it("does not block a plain read behind a write", async () => {
    const { spawn, records } = createFakeSpawn();
    const client = createTestClient(spawn);
    const write = client.invoke({
      args: ["commit", "-m", "message"],
      cwd: "/repo",
      signal: new AbortController().signal,
      operationClass: "write",
      sshCommandConfigured: true,
    });

    await waitFor(() => records.length === 1);

    const read = client.invoke({
      args: ["rev-parse", "HEAD"],
      cwd: "/repo",
      signal: new AbortController().signal,
      operationClass: "read",
      sshCommandConfigured: true,
    });

    await waitFor(() => records.length === 2);
    records[0]?.child.close(0, null);
    records[1]?.child.close(0, null);
    await Promise.all([write, read]);

    expect(records.map((record) => record.args[0])).toEqual(["commit", "rev-parse"]);
  });

  it("does not let a new shared read bypass a queued exclusive writer", async () => {
    const { spawn, records } = createFakeSpawn();
    const client = createTestClient(spawn);
    const firstRead = client.invoke({
      args: ["status"],
      cwd: "/repo",
      signal: new AbortController().signal,
      operationClass: "read",
      sshCommandConfigured: true,
    });

    await waitFor(() => records.length === 1);

    const write = client.invoke({
      args: ["commit", "-m", "message"],
      cwd: "/repo",
      signal: new AbortController().signal,
      operationClass: "write",
      sshCommandConfigured: true,
    });
    const secondRead = client.invoke({
      args: ["diff"],
      cwd: "/repo",
      signal: new AbortController().signal,
      operationClass: "read",
      sshCommandConfigured: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(records).toHaveLength(1);

    records[0]?.child.close(0, null);
    await waitFor(() => records.length === 2);
    expect(records[1]?.args[0]).toBe("commit");

    records[1]?.child.close(0, null);
    await waitFor(() => records.length === 3);
    expect(records[2]?.args[0]).toBe("diff");

    records[2]?.child.close(0, null);
    await Promise.all([firstRead, write, secondRead]);
  });

  it("allows concurrent index reads", async () => {
    const { spawn, records } = createFakeSpawn();
    const client = createTestClient(spawn);
    const first = client.invoke({
      args: ["status"],
      cwd: "/repo",
      signal: new AbortController().signal,
      operationClass: "read",
      sshCommandConfigured: true,
    });
    const second = client.invoke({
      args: ["diff"],
      cwd: "/repo",
      signal: new AbortController().signal,
      operationClass: "read",
      sshCommandConfigured: true,
    });

    await waitFor(() => records.length === 2);
    records[0]?.child.close(0, null);
    records[1]?.child.close(0, null);
    await Promise.all([first, second]);

    expect(records).toHaveLength(2);
  });
});
