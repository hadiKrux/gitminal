import { beforeEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { useRepository } from "@/app/hooks/useRepository";
import { ConfigProvider } from "@/app/providers/ConfigProvider";
import { RepositoryProvider } from "@/app/providers/RepositoryProvider";
import type { RepositoryContextValue } from "@/app/providers/RepositoryProvider.types";
import type {
  GitClient,
  GitInvocationResult,
  GitWatcher,
  GitWatcherOptions,
} from "@/domain/git/git.types";
import { selectRemoteFreshness } from "@/domain/repository/repository.selectors";

/** Latest repository context captured by the probe. */
let latest: RepositoryContextValue | undefined;

/** Canonical status output for a clean branch two ahead and one behind. */
const STATUS_OUTPUT =
  "# branch.oid abc123\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -1\0? untracked.txt\0";

/**
 * Builds an invocation result.
 *
 * @param stdout - Captured output.
 * @param ok - Whether git exited cleanly.
 * @param stderr - Captured standard error.
 * @returns The synthetic result.
 */
function result(stdout: string, ok: boolean = true, stderr: string = ""): GitInvocationResult {
  return {
    argv: ["git"],
    cwd: "/repo",
    exitCode: ok ? 0 : 1,
    terminationSignal: null,
    stdout,
    stderr,
    durationMs: 0,
    cancelled: false,
    timedOut: false,
    timedOutAfterMs: null,
    spawnError: null,
    ok,
  };
}

/** Fake git client plus its mutable answers and call counts. */
interface FakeGit {
  readonly client: GitClient;
  readonly counts: Map<string, number>;
  setStatusOutput(output: string): void;
  setStatusFailure(failure: boolean): void;
}

/**
 * Creates a fake git client that answers the provider reads from recorded output.
 *
 * @returns The fake client with mutable status answers.
 */
function createFakeGit(): FakeGit {
  const counts = new Map<string, number>();
  let statusOutput = STATUS_OUTPUT;
  let statusFailure = false;
  const answers: Readonly<Record<string, () => GitInvocationResult>> = {
    "rev-parse --is-inside-work-tree": () => result("true\n"),
    "rev-parse --is-bare-repository --absolute-git-dir": () => result("false\n/repo/.git\n"),
    "rev-parse --show-toplevel": () => result("/repo\n"),
    "rev-parse --verify HEAD": () => result("abc123\n"),
    "symbolic-ref -q --short HEAD": () => result("main\n"),
    "rev-parse --verify --quiet MERGE_HEAD": () => result("", false),
    "rev-parse --verify --quiet REBASE_HEAD": () => result("", false),
    "rev-parse --verify --quiet CHERRY_PICK_HEAD": () => result("", false),
    "remote -v": () =>
      result("origin\tgit@example.com:repo.git (fetch)\norigin\tgit@example.com:repo.git (push)\n"),
    "config user.name": () => result("Test User\n"),
    "config user.email": () => result("test@example.com\n"),
    "for-each-ref --format=%(upstream:remotename)%09%(upstream:remoteref) refs/heads/main": () =>
      result("origin\trefs/heads/main\n"),
    "rev-parse --verify --quiet refs/remotes/origin/main": () => result("abc123\n"),
  };

  return {
    counts,
    client: {
      gitPath: "git",
      invoke: async (options) => {
        const key = options.args.join(" ");
        counts.set(key, (counts.get(key) ?? 0) + 1);

        if (key === "status --porcelain=v2 --branch -z --untracked-files=all") {
          return statusFailure
            ? result("", false, "fatal: unable to read index")
            : result(statusOutput);
        }

        const answer = answers[key];

        return answer === undefined ? result("", false) : answer();
      },
    },
    setStatusOutput(output: string): void {
      statusOutput = output;
    },
    setStatusFailure(failure: boolean): void {
      statusFailure = failure;
    },
  };
}

/** Captured fake watcher. */
interface FakeWatcher {
  readonly factory: (options: GitWatcherOptions) => GitWatcher;
  readonly options: GitWatcherOptions[];
  readonly stopped: () => number;
  emit(): void;
}

/**
 * Creates a fake watcher factory.
 *
 * @returns The factory plus its recorded state.
 */
function createFakeWatcher(): FakeWatcher {
  const options: GitWatcherOptions[] = [];
  let stopped = 0;
  let listener: (() => void) | null = null;

  return {
    options,
    stopped: () => stopped,
    emit: () => listener?.(),
    factory: (watcherOptions) => {
      options.push(watcherOptions);
      listener = watcherOptions.onRefresh;

      return {
        start(): void {},
        stop(): void {
          stopped += 1;
        },
        get status() {
          return {
            watching: true,
            mode: watcherOptions.mode ?? "git-dir",
            path: watcherOptions.gitDir,
            recursive: true,
            limitation: null,
          };
        },
      };
    },
  };
}

/** Captures the repository context. */
function RepositoryProbe(): ReactNode {
  latest = useRepository();

  return <text id="repository-probe">{latest.snapshot?.branch ?? latest.state.primary}</text>;
}

/**
 * Renders the provider with the probe.
 *
 * @param client - Fake client.
 * @param watcher - Optional watcher factory.
 * @param worktreeWatch - Opt-in worktree watch.
 * @returns The renderer setup.
 */
async function renderRepository(
  client: GitClient,
  watcher?: (options: GitWatcherOptions) => GitWatcher,
  worktreeWatch: boolean = false,
): Promise<Awaited<ReturnType<typeof testRender>>> {
  latest = undefined;

  let setup: Awaited<ReturnType<typeof testRender>> | undefined;

  await act(async () => {
    setup = await testRender(
      <ConfigProvider>
        <RepositoryProvider
          cwd="/repo"
          gitClient={client}
          createWatcher={watcher}
          enableWatcher={watcher !== undefined}
          watchDebounceMs={1}
          worktreeWatch={worktreeWatch}
          now={() => 5_000}
        >
          <RepositoryProbe />
        </RepositoryProvider>
      </ConfigProvider>,
      { width: 80, height: 20 },
    );
  });

  if (setup === undefined) {
    throw new Error("renderer setup missing");
  }

  return setup;
}

/**
 * Waits until the provider has a loaded state.
 *
 * @param setup - Renderer setup.
 * @returns A promise resolved after the first read settles.
 */
async function waitForLoad(setup: Awaited<ReturnType<typeof testRender>>): Promise<void> {
  const deadline = Date.now() + 2_000;

  while ((latest === undefined || latest.state.primary === "loading") && Date.now() < deadline) {
    await act(async () => {
      await setup.renderOnce();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

beforeEach(() => {
  latest = undefined;
});

describe("RepositoryProvider", () => {
  it("loads the snapshot and derives state, upstream, and counts", async () => {
    const setup = await renderRepository(createFakeGit().client);

    await waitForLoad(setup);

    expect(latest?.state.primary).toBe("normal");
    expect(latest?.snapshot?.branch).toBe("main");
    expect(latest?.upstreamStatus).toBe("healthy");
    expect(latest?.snapshot?.status?.untrackedCount).toBe(1);
    expect(latest?.watch.watching).toBe(false);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("refreshes status without reading history and keeps the selection", async () => {
    const fake = createFakeGit();
    const setup = await renderRepository(fake.client);

    await waitForLoad(setup);
    await act(async () => {
      latest?.setSelection({ kind: "commit", oid: "abc123" });
    });

    fake.setStatusOutput(
      "# branch.oid abc123\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +5 -3\0? a.txt\0? b.txt\0",
    );

    await act(async () => {
      await latest?.refreshStatus();
    });

    expect(fake.counts.get("status --porcelain=v2 --branch -z --untracked-files=all")).toBe(2);
    expect(fake.counts.get("log")).toBeUndefined();
    expect(latest?.snapshot?.status?.untrackedCount).toBe(2);
    expect(latest?.selection).toEqual({ kind: "commit", oid: "abc123" });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("coalesces a concurrent status refresh into the in-flight read", async () => {
    const fake = createFakeGit();
    const setup = await renderRepository(fake.client);

    await waitForLoad(setup);

    let left: Awaited<ReturnType<RepositoryContextValue["refreshStatus"]>> | undefined;
    let right: Awaited<ReturnType<RepositoryContextValue["refreshStatus"]>> | undefined;

    await act(async () => {
      const first = latest?.refreshStatus();
      const second = latest?.refreshStatus();
      [left, right] = await Promise.all([first, second]);
    });

    expect(left?.coalesced).toBe(false);
    expect(right?.coalesced).toBe(true);
    expect(fake.counts.get("status --porcelain=v2 --branch -z --untracked-files=all")).toBe(2);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the previous snapshot and records a non-blocking error when a read fails", async () => {
    const fake = createFakeGit();
    const setup = await renderRepository(fake.client);

    await waitForLoad(setup);
    fake.setStatusFailure(true);

    let outcome: Awaited<ReturnType<RepositoryContextValue["refreshStatus"]>> | undefined;

    await act(async () => {
      outcome = await latest?.refreshStatus();
    });

    expect(outcome?.ok).toBe(false);
    expect(latest?.snapshot?.branch).toBe("main");
    expect(latest?.state.primary).toBe("normal");
    expect(latest?.lastRefreshError).toContain("unable to read index");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("starts the git-directory watcher and refreshes status on an event", async () => {
    const fake = createFakeGit();
    const watcher = createFakeWatcher();
    const setup = await renderRepository(fake.client, watcher.factory);

    await waitForLoad(setup);

    expect(watcher.options[0]?.gitDir).toBe("/repo/.git");
    expect(watcher.options[0]?.mode).toBe("git-dir");
    expect(latest?.watch).toEqual({
      watching: true,
      mode: "git-dir",
      path: "/repo/.git",
      recursive: true,
      limitation: null,
    });

    const before = fake.counts.get("status --porcelain=v2 --branch -z --untracked-files=all") ?? 0;

    await act(async () => {
      watcher.emit();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    expect(
      fake.counts.get("status --porcelain=v2 --branch -z --untracked-files=all"),
    ).toBeGreaterThan(before);

    await act(async () => {
      await setup.dispose();
    });

    expect(watcher.stopped()).toBe(1);
  });

  it("watches the worktree only in the opt-in mode", async () => {
    const watcher = createFakeWatcher();
    const setup = await renderRepository(createFakeGit().client, watcher.factory, true);

    await waitForLoad(setup);

    expect(watcher.options[0]?.mode).toBe("worktree");
    expect(watcher.options[0]?.worktreePath).toBe("/repo");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("tracks per-remote successful checks for freshness", async () => {
    const setup = await renderRepository(createFakeGit().client);

    await waitForLoad(setup);

    expect(latest?.remoteChecks.origin).toEqual({
      lastSuccessfulCheckAt: null,
      lastSuccessfulFetchAt: null,
    });

    await act(async () => {
      latest?.recordRemoteCheck("origin", "fetch", true);
    });

    expect(latest?.remoteChecks.origin?.lastSuccessfulFetchAt).toBe(5_000);
    expect(selectRemoteFreshness(latest?.remoteChecks.origin, 5_100)).toBe("fresh");

    await act(async () => {
      latest?.recordRemoteCheck("origin", "check", false);
    });

    expect(latest?.remoteChecks.origin?.lastSuccessfulCheckAt).toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("classifies a missing upstream as gone, unknown, then deleted after a prune", async () => {
    const fake = createFakeGit();
    const baseInvoke = fake.client.invoke;
    const client: GitClient = {
      gitPath: "git",
      invoke: async (options) => {
        if (options.args.join(" ") === "rev-parse --verify --quiet refs/remotes/origin/main") {
          return result("", false);
        }

        return await baseInvoke(options);
      },
    };
    const setup = await renderRepository(client);

    await waitForLoad(setup);

    expect(latest?.upstreamStatus).toBe("gone");

    await act(async () => {
      await latest?.markUpstreamUnknown("origin/main");
    });

    expect(latest?.upstreamStatus).toBe("unknown");

    await act(async () => {
      await latest?.confirmUpstreamAbsent("origin/main", "prune");
    });

    expect(latest?.upstreamStatus).toBe("deleted-after-prune");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("reloads the graph window through the registered refresher and coalesces", async () => {
    const setup = await renderRepository(createFakeGit().client);

    await waitForLoad(setup);

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;

    await act(async () => {
      latest?.registerGraphWindowRefresher(async () => {
        calls += 1;
        await gate;
      });
    });

    let first: Awaited<ReturnType<RepositoryContextValue["refreshGraphWindow"]>> | undefined;
    let second: Awaited<ReturnType<RepositoryContextValue["refreshGraphWindow"]>> | undefined;

    await act(async () => {
      const left = latest?.refreshGraphWindow();
      const right = latest?.refreshGraphWindow();
      release();
      [first, second] = await Promise.all([left, right]);
    });

    expect(calls).toBe(1);
    expect(first?.ok).toBe(true);
    expect(second?.coalesced).toBe(true);
    expect(latest?.isGraphInFlight).toBe(false);

    await act(async () => {
      latest?.registerGraphWindowRefresher(null);
      await setup.dispose();
    });
  });

  it("reports a non-repository directory as a valid state", async () => {
    const client: GitClient = {
      gitPath: "git",
      invoke: async () => result("", false, "fatal: not a git repository"),
    };
    const setup = await renderRepository(client);

    await waitForLoad(setup);

    expect(latest?.state.primary).toBe("not-a-repository");
    expect(latest?.snapshot).toBeNull();
    expect(latest?.getAvailability("remote.push", { kind: "none" }, "top-bar")).toEqual({
      available: false,
      reason: "not-a-repository",
    });

    await act(async () => {
      await setup.dispose();
    });
  });
});
