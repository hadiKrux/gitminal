import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createGitClient } from "@/domain/git/git.client";
import type { GitClient, GitInvocationResult, GitOperationClass } from "@/domain/git/git.types";

/** Minimum git version the integration suite runs against. */
const MINIMUM_GIT_VERSION = "2.31.0";

/** Options accepted when creating a temporary repository. */
export interface GitFixtureOptions {
  /** Run `git init` and configure identity. Set false for a plain directory. */
  readonly initialize?: boolean;
  /** Create a bare repository. */
  readonly bare?: boolean;
  /** Seed one commit after initialization. Defaults to true. */
  readonly seed?: boolean;
  /** Reuse an existing directory instead of creating a temporary one. Cleanup never removes it. */
  readonly directory?: string;
}

/** Options for one command issued through the fixture. */
export interface GitFixtureRunOptions {
  /** Operation class that selects the timeout. Defaults to `read`. */
  readonly operationClass?: GitOperationClass;
  /** Explicit timeout in milliseconds. */
  readonly timeoutMs?: number;
  /** Cancellation signal. Defaults to a fresh, never-aborted signal. */
  readonly signal?: AbortSignal;
}

/** Runs one git command through the fixture client. */
type GitFixtureRun = (
  args: readonly string[],
  options?: GitFixtureRunOptions,
) => Promise<GitInvocationResult>;

/** File helpers bound to one repository root. */
interface GitFixtureFiles {
  /** Writes a file below the root. */
  readonly writeFile: (relativePath: string, content: string) => void;
  /** Deletes a path below the root. */
  readonly removePath: (relativePath: string) => void;
  /** Creates a directory below the root and returns its absolute path. */
  readonly createDirectory: (relativePath: string) => string;
  /** Resolves a root-relative path. */
  readonly resolvePath: (relativePath: string) => string;
}

/** A temporary repository plus the production client bound to it. */
export interface GitFixture extends GitFixtureFiles {
  /** Absolute repository root. */
  readonly root: string;
  /** Absolute git directory. */
  readonly gitDir: string;
  /** Production client bound to the fixture repository. */
  readonly client: GitClient;
  /**
   * Runs one git command through the production client.
   *
   * @param args - Git arguments without the executable.
   * @param options - Operation class, timeout, and signal.
   * @returns The settled invocation result.
   */
  run: GitFixtureRun;
  /**
   * Stages every change and commits it.
   *
   * @param message - Commit message.
   * @param options - Operation class override, timeout, and signal.
   * @returns The commit result.
   */
  commit(message: string, options?: GitFixtureRunOptions): Promise<GitInvocationResult>;
  /**
   * Writes an executable hook into the git directory.
   *
   * @param name - Hook name such as `pre-commit`.
   * @param script - Full script body including the shebang.
   */
  createHook(name: string, script: string): void;
  /**
   * Creates a branch and a main-side commit that conflict on `shared.txt`.
   *
   * The repository is left mid-merge with conflicted files.
   *
   * @returns The failed merge result.
   */
  createMergeConflict(): Promise<GitInvocationResult>;
  /**
   * Creates a branch and a main-side commit that conflict on `shared.txt`.
   *
   * The repository is left mid-rebase with conflicted files.
   *
   * @returns The failed rebase result.
   */
  createRebaseConflict(): Promise<GitInvocationResult>;
  /**
   * Creates an empty `.git/index.lock` to simulate a locked index.
   *
   * @returns The absolute lock path.
   */
  createIndexLock(): string;
  /** Removes the temporary directory. Safe to call more than once. */
  cleanup(): void;
}

/**
 * Reports whether the installed git meets the documented minimum.
 *
 * Integration tests skip when this returns false, so a missing or old git is reported as a skip,
 * never as a pass.
 *
 * @returns True when `git --version` is at least `MINIMUM_GIT_VERSION`.
 */
export function isGitAvailable(): boolean {
  const version = readGitVersion();

  return version !== null && compareVersions(version, MINIMUM_GIT_VERSION) >= 0;
}

/**
 * Reads the installed git version.
 *
 * @returns The parsed version, or null when git is missing or unparseable.
 */
function readGitVersion(): string | null {
  const result = spawnSync("git", ["--version"], { encoding: "utf8" });

  if (result.status !== 0) {
    return null;
  }

  const match = /git version (\d+\.\d+(?:\.\d+)?)/.exec(result.stdout);

  return match?.[1] ?? null;
}

/**
 * Compares two dotted versions numerically.
 *
 * @param left - First version.
 * @param right - Second version.
 * @returns A negative value when left is older, zero when equal, positive when newer.
 */
function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map((part) => Number.parseInt(part, 10));
  const rightParts = right.split(".").map((part) => Number.parseInt(part, 10));
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

/**
 * Runs a fixture, then always removes its temporary directory.
 *
 * @param options - Fixture options.
 * @param run - Callback that receives the fixture.
 * @returns The callback result.
 */
export async function withGitFixture<T>(
  options: GitFixtureOptions,
  run: (fixture: GitFixture) => Promise<T>,
): Promise<T> {
  const fixture = await createGitFixture(options);

  try {
    return await run(fixture);
  } finally {
    fixture.cleanup();
  }
}

/**
 * Creates a temporary repository for integration tests.
 *
 * Initialization runs through `git` directly because it happens before the client can operate on
 * the repository. Every other command, including identity configuration, seeding, checkout, merge,
 * and rebase, runs through `git.client.ts`, so the production execution contract is what the tests
 * exercise. The caller must call `cleanup`, normally through `withGitFixture`.
 *
 * @param options - Initialization, bare, seed, and directory options.
 * @returns The fixture with its repository root and bound client.
 */
async function createGitFixture(options: GitFixtureOptions = {}): Promise<GitFixture> {
  const { root, ownsRoot } = resolveFixtureRoot(options);
  const initialize = options.initialize ?? true;
  const bare = options.bare ?? false;
  const environment = createFixtureEnvironment();

  try {
    mkdirSync(root, { recursive: true });

    if (initialize) {
      runGitSetup(
        root,
        bare ? ["init", "--bare", "-b", "main"] : ["init", "-b", "main"],
        environment.env,
      );
    }

    const fixture = assembleFixture(root, bare, ownsRoot, environment);

    if (initialize) {
      await configureIdentity(fixture);
    }

    await seedWhenRequested(fixture, options, initialize, bare);

    return fixture;
  } catch (error) {
    environment.cleanup();

    if (ownsRoot) {
      rmSync(root, { recursive: true, force: true, maxRetries: 3 });
    }

    throw error;
  }
}

/**
 * Resolves the temporary or supplied fixture directory to an absolute real path.
 *
 * @param options - Fixture options.
 * @returns The absolute repository root and whether the fixture owns it.
 */
function resolveFixtureRoot(options: GitFixtureOptions): { root: string; ownsRoot: boolean } {
  if (options.directory !== undefined) {
    return { root: options.directory, ownsRoot: false };
  }

  return {
    root: realpathSync(mkdtempSync(path.join(tmpdir(), "gitminal-fixture-"))),
    ownsRoot: true,
  };
}

/**
 * Environment overrides that keep integration fixtures hermetic.
 *
 * Ambient user or system git configuration must not change push defaults, hooks, identity, or
 * remotes while a fixture runs. The production environment matrix is untouched. `GIT_CONFIG_GLOBAL`
 * and `GIT_CONFIG_SYSTEM` need git 2.32, so the fixture also sets `GIT_CONFIG_NOSYSTEM` and points
 * `HOME` and `XDG_CONFIG_HOME` at a per-fixture temporary directory, which is ignored on every
 * supported version including the 2.31 floor.
 */
interface FixtureEnvironment {
  /** Environment additions applied to every fixture invocation. */
  readonly env: Readonly<Record<string, string>>;
  /** Removes the per-fixture config home. Safe to call more than once. */
  cleanup(): void;
}

/**
 * Creates an isolated git configuration home for one fixture.
 *
 * @returns The environment additions and their cleanup.
 */
function createFixtureEnvironment(): FixtureEnvironment {
  const configHome = realpathSync(mkdtempSync(path.join(tmpdir(), "gitminal-fixture-env-")));

  mkdirSync(path.join(configHome, "xdg"), { recursive: true });

  return {
    env: Object.freeze({
      GIT_CONFIG_GLOBAL: nullDevice(),
      GIT_CONFIG_SYSTEM: nullDevice(),
      GIT_CONFIG_NOSYSTEM: "1",
      HOME: configHome,
      XDG_CONFIG_HOME: path.join(configHome, "xdg"),
    }),
    cleanup(): void {
      rmSync(configHome, { recursive: true, force: true, maxRetries: 3 });
    },
  };
}

/**
 * Resolves the platform null device used to disable a git config file.
 *
 * @returns `NUL` on Windows and `/dev/null` elsewhere.
 */
function nullDevice(): string {
  return process.platform === "win32" ? "NUL" : "/dev/null";
}

/**
 * Builds the fixture client with ambient git configuration disabled.
 *
 * @param environment - Per-fixture config isolation.
 * @returns The production client bound to the fixture environment.
 */
function createFixtureClient(environment: FixtureEnvironment): GitClient {
  return createGitClient({
    baseEnv: { ...process.env, ...environment.env },
    resolveSshCommandConfigured: async () => false,
  });
}

/**
 * Builds the fixture object with its client and helpers.
 *
 * @param root - Absolute repository root.
 * @param bare - Whether the repository is bare.
 * @param ownsRoot - True when cleanup may remove the root.
 * @param environment - Per-fixture config isolation.
 * @returns The fixture without identity configuration or seed content.
 */
function assembleFixture(
  root: string,
  bare: boolean,
  ownsRoot: boolean,
  environment: FixtureEnvironment,
): GitFixture {
  const gitDir = path.join(root, bare ? "" : ".git");
  const client = createFixtureClient(environment);
  const run = createFixtureRun(client, root);
  const files = createFixtureFiles(root);
  const commit = createFixtureCommit(run);
  const conflicts = createConflictHelpers(run, files, commit);
  const hooks = createFixtureHookTools(gitDir);

  return {
    root,
    gitDir,
    client,
    run,
    ...files,
    commit,
    ...conflicts,
    ...hooks,
    cleanup(): void {
      environment.cleanup();

      if (ownsRoot) {
        rmSync(root, { recursive: true, force: true, maxRetries: 3 });
      }
    },
  };
}

/**
 * Seeds the repository when the fixture requested it.
 *
 * @param fixture - Fixture to seed.
 * @param options - Fixture options.
 * @param initialize - Whether the repository was initialized.
 * @param bare - Whether the repository is bare.
 */
async function seedWhenRequested(
  fixture: GitFixture,
  options: GitFixtureOptions,
  initialize: boolean,
  bare: boolean,
): Promise<void> {
  if (!initialize || bare || options.seed === false) {
    return;
  }

  await seedRepository(fixture);
}

/**
 * Creates the command runner bound to one repository root.
 *
 * @param client - Production client.
 * @param root - Repository root used as the working directory.
 * @returns The run function.
 */
function createFixtureRun(client: GitClient, root: string): GitFixtureRun {
  return async (args, options = {}) =>
    await client.invoke({
      args,
      cwd: root,
      signal: options.signal ?? new AbortController().signal,
      operationClass: options.operationClass ?? "read",
      timeoutMs: options.timeoutMs,
    });
}

/**
 * Creates file helpers bound to one repository root.
 *
 * @param root - Repository root.
 * @returns The file helpers.
 */
function createFixtureFiles(root: string): GitFixtureFiles {
  return {
    writeFile(relativePath: string, content: string): void {
      const target = resolveInsideRoot(root, relativePath);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, content);
    },
    removePath(relativePath: string): void {
      rmSync(resolveInsideRoot(root, relativePath), { recursive: true, force: true });
    },
    createDirectory(relativePath: string): string {
      const target = resolveInsideRoot(root, relativePath);
      mkdirSync(target, { recursive: true });

      return target;
    },
    resolvePath(relativePath: string): string {
      return resolveInsideRoot(root, relativePath);
    },
  };
}

/**
 * Creates the commit helper for one fixture.
 *
 * @param run - Fixture command runner.
 * @returns The commit function.
 */
function createFixtureCommit(run: GitFixtureRun): GitFixture["commit"] {
  return async (message, options = {}) => {
    await run(["add", "-A"], { operationClass: "write", signal: options.signal });

    return await run(["commit", "-m", message, "--no-gpg-sign"], {
      operationClass: "write",
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  };
}

/**
 * Creates the merge and rebase conflict helpers.
 *
 * @param run - Fixture command runner.
 * @param files - Fixture file helpers.
 * @param commit - Fixture commit helper.
 * @returns The conflict helpers.
 */
function createConflictHelpers(
  run: GitFixtureRun,
  files: GitFixtureFiles,
  commit: GitFixture["commit"],
): Pick<GitFixture, "createMergeConflict" | "createRebaseConflict"> {
  const createConflictState = async (): Promise<void> => {
    files.writeFile("shared.txt", "base\n");
    await commit("Add shared file");
    await run(["checkout", "-b", "conflict"], { operationClass: "write" });
    files.writeFile("shared.txt", "branch change\n");
    await commit("Branch change");
    await run(["checkout", "main"], { operationClass: "write" });
    files.writeFile("shared.txt", "main change\n");
    await commit("Main change");
  };

  return {
    async createMergeConflict(): Promise<GitInvocationResult> {
      await createConflictState();

      return await run(["merge", "conflict"], { operationClass: "write" });
    },
    async createRebaseConflict(): Promise<GitInvocationResult> {
      await createConflictState();
      await run(["checkout", "conflict"], { operationClass: "write" });

      return await run(["rebase", "main"], { operationClass: "write" });
    },
  };
}

/**
 * Creates the hook and index-lock helpers.
 *
 * @param gitDir - Absolute git directory.
 * @returns The hook and lock helpers.
 */
function createFixtureHookTools(
  gitDir: string,
): Pick<GitFixture, "createHook" | "createIndexLock"> {
  return {
    createHook(name: string, script: string): void {
      const hookPath = path.join(gitDir, "hooks", name);
      mkdirSync(path.dirname(hookPath), { recursive: true });
      writeFileSync(hookPath, script);
      chmodSync(hookPath, 0o755);
    },
    createIndexLock(): string {
      const lockPath = path.join(gitDir, "index.lock");
      writeFileSync(lockPath, "");

      return lockPath;
    },
  };
}

/**
 * Configures a local identity, disables GPG signing, and points hooks at the fixture directory.
 *
 * The hooks path is set locally so a user-level `core.hooksPath` cannot bypass the hooks a test
 * installs.
 *
 * @param fixture - Fixture whose identity is configured.
 */
async function configureIdentity(fixture: GitFixture): Promise<void> {
  await fixture.run(["config", "user.name", "Gitminal Test"], { operationClass: "write" });
  await fixture.run(["config", "user.email", "test@gitminal.invalid"], { operationClass: "write" });
  await fixture.run(["config", "commit.gpgsign", "false"], { operationClass: "write" });
  await fixture.run(["config", "core.hooksPath", path.join(fixture.gitDir, "hooks")], {
    operationClass: "write",
  });
}

/**
 * Writes and commits the seed file.
 *
 * @param fixture - Fixture to seed.
 */
async function seedRepository(fixture: GitFixture): Promise<void> {
  fixture.writeFile("README.md", "gitminal fixture\n");
  const seeded = await fixture.commit("Initial commit");

  if (!seeded.ok) {
    throw new Error(`fixture seed commit failed: ${seeded.stderr}`);
  }
}

/**
 * Runs a setup command directly, for repository creation only.
 *
 * @param cwd - Working directory.
 * @param args - Git arguments without the executable.
 * @param env - Fixture environment additions that isolate git configuration.
 */
function runGitSetup(
  cwd: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
): void {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    throw new Error(`fixture git ${args.join(" ")} failed: ${result.stderr}`);
  }
}

/**
 * Resolves a path and rejects one that escapes the fixture root.
 *
 * @param root - Fixture repository root.
 * @param relativePath - Candidate root-relative path.
 * @returns The absolute path inside the root.
 */
function resolveInsideRoot(root: string, relativePath: string): string {
  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`fixture path escapes the repository root: ${relativePath}`);
  }

  return target;
}
