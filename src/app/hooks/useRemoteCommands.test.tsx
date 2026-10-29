import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { resetCommandOrchestration } from "@/app/hooks/commandRunner.state";
import { useRemoteCommands } from "@/app/hooks/useRemoteCommands";
import { useRepository } from "@/app/hooks/useRepository";
import { ConfigProvider } from "@/app/providers/ConfigProvider";
import { RepositoryProvider } from "@/app/providers/RepositoryProvider";
import type { RepositoryContextValue } from "@/app/providers/RepositoryProvider.types";
import { resetCommandRunner, runCommand } from "@/domain/commands/commands.runner";
import type { CommandTarget } from "@/domain/commands/commands.types";
import type { GitClient, GitInvocationResult, GitWatcherFactory } from "@/domain/git/git.types";

/** Latest repository context captured by the probe. */
let latestRepository: RepositoryContextValue | undefined;

/** Canonical status output for a normal repository with an upstream. */
const STATUS_OUTPUT =
  "# branch.oid abc123\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +0 -0\0";

/**
 * Builds an invocation result.
 *
 * @param stdout - Captured output.
 * @param ok - Whether git exited cleanly.
 * @returns The synthetic result.
 */
function result(stdout: string = "", ok: boolean = true): GitInvocationResult {
  return {
    argv: ["git"],
    cwd: "/repo",
    exitCode: ok ? 0 : 1,
    terminationSignal: null,
    stdout,
    stderr: ok ? "" : "fatal: failed",
    durationMs: 0,
    cancelled: false,
    timedOut: false,
    timedOutAfterMs: null,
    spawnError: null,
    ok,
  };
}

/**
 * Creates a fake git client that answers the repository read path and every remote executor.
 *
 * @returns The fake client and its invocation counter.
 */
function createFakeGit(): { client: GitClient; invocations: () => number } {
  let invocations = 0;
  const answers: Readonly<Record<string, () => GitInvocationResult>> = {
    "rev-parse --is-inside-work-tree": () => result("true\n"),
    "rev-parse --is-bare-repository --absolute-git-dir": () => result("false\n/repo/.git\n"),
    "rev-parse --show-toplevel": () => result("/repo\n"),
    "rev-parse --verify HEAD": () => result("abc123\n"),
    "symbolic-ref -q --short HEAD": () => result("main\n"),
    "rev-parse --verify --quiet MERGE_HEAD": () => result("", false),
    "rev-parse --verify --quiet REBASE_HEAD": () => result("", false),
    "rev-parse --verify --quiet CHERRY_PICK_HEAD": () => result("", false),
    "remote -v": () => result("origin\tgit@example.com:repo.git (fetch)\n"),
    "config --get-all remote.origin.fetch": () => result("+refs/heads/*:refs/remotes/origin/*\n"),
    "config user.name": () => result("Test User\n"),
    "config user.email": () => result("test@example.com\n"),
    "for-each-ref --format=%(upstream:remotename)%09%(upstream:remoteref) refs/heads/main": () =>
      result("origin\trefs/heads/main\n"),
    "for-each-ref --format=%(upstream:short) refs/heads": () => result("origin/main\n"),
    "rev-parse --verify --quiet refs/remotes/origin/main": () => result("abc123\n"),
    "branch --show-current": () => result("main\n"),
    remote: () => result("origin\n"),
    "pull --progress --no-edit": () => result(""),
    "push --progress -- origin refs/heads/main:refs/heads/main": () => result(""),
    "push --progress --force-with-lease -- origin refs/heads/main:refs/heads/main": () =>
      result(""),
    "push --progress --force -- origin refs/heads/main:refs/heads/main": () => result(""),
    "push --progress --no-verify -- origin refs/heads/main:refs/heads/main": () => result(""),
    "for-each-ref --format=%(refname:short)%09%(upstream:remotename)%09%(upstream:remoteref) refs/heads":
      () => result("main\torigin\trefs/heads/main\n"),
    "ls-remote --heads -- origin": () => result("abc123\trefs/heads/main\n"),
    "fetch --progress --no-prune --no-prune-tags -- origin": () => result(""),
  };

  return {
    invocations: () => invocations,
    client: {
      gitPath: "git",
      invoke: async (options) => {
        invocations += 1;

        const key = options.args.join(" ");

        if (key === "status --porcelain=v2 --branch -z --untracked-files=all") {
          return result(STATUS_OUTPUT);
        }

        const answer = answers[key];

        return answer === undefined ? result("", false) : answer();
      },
    },
  };
}

/** Never starts a watcher in these tests. */
const NOOP_WATCHER: GitWatcherFactory = () => ({
  start(): void {},
  stop(): void {},
  status: { watching: false, mode: "git-dir", path: null, recursive: false, limitation: null },
});

/**
 * Captures the repository context and installs the remote command handlers.
 *
 * @returns A non-focusable marker.
 */
function RemoteCommandProbe(): ReactNode {
  latestRepository = useRepository();
  useRemoteCommands();

  return <text id="remote-probe">probe</text>;
}

/**
 * Renders two probes so a duplicate mount attempts a second registration.
 *
 * @returns The renderer setup.
 */
async function renderRemoteCommands(
  client: GitClient = createFakeGit().client,
  probeCount: number = 2,
): Promise<Awaited<ReturnType<typeof testRender>>> {
  latestRepository = undefined;

  const setup = await testRender(
    <ConfigProvider>
      <RepositoryProvider
        cwd="/repo"
        gitClient={client}
        createWatcher={NOOP_WATCHER}
        enableWatcher={false}
        now={() => 0}
      >
        {Array.from({ length: probeCount }, (_, index) => `probe-${index}`).map((id) => (
          <RemoteCommandProbe key={id} />
        ))}
      </RepositoryProvider>
    </ConfigProvider>,
    { width: 80, height: 20 },
  );
  const deadline = Date.now() + 2_000;

  while (latestRepository === undefined && Date.now() < deadline) {
    await act(async () => {
      await setup.renderOnce();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }

  return setup;
}

/** Every remote command the top bar dispatches. */
const REMOTE_COMMAND_IDS = [
  "remote.fetch",
  "remote.fetchPrune",
  "remote.pull",
  "remote.push",
  "remote.pushForceSafe",
  "remote.pushForceOverwrite",
  "remote.pushNoVerify",
] as const;

/**
 * Reads the target a command needs.
 *
 * @param commandId - Remote command id.
 * @returns The explicit target.
 */
function targetFor(commandId: string): CommandTarget {
  return commandId === "remote.fetch" || commandId === "remote.fetchPrune"
    ? { kind: "none" }
    : { kind: "branch", name: "main" };
}

beforeEach(() => {
  resetCommandRunner();
  resetCommandOrchestration();
  latestRepository = undefined;
});

afterEach(() => {
  resetCommandRunner();
  resetCommandOrchestration();
});

describe("useRemoteCommands", () => {
  it("registers every remote handler and rejects a duplicate mount", async () => {
    const errors: unknown[][] = [];
    const originalError = console.error;

    console.error = (...args: unknown[]): void => {
      errors.push(args);
    };

    try {
      const setup = await renderRemoteCommands();

      expect(errors).toHaveLength(REMOTE_COMMAND_IDS.length);

      const repository = latestRepository;

      if (repository === undefined) {
        throw new Error("repository probe missing");
      }

      try {
        for (const commandId of REMOTE_COMMAND_IDS) {
          let outcome: Awaited<ReturnType<typeof runCommand>> | undefined;

          await act(async () => {
            outcome = await runCommand(
              { commandId, target: targetFor(commandId) },
              {
                state: repository.state,
                signals: repository.signals,
                target: targetFor(commandId),
                region: "top-bar",
                client: repository.gitClient,
              },
            );
          });

          expect(outcome?.blockedReason).not.toBe("command-not-implemented");
        }
      } finally {
        await act(async () => {
          await setup.dispose();
        });
      }
    } finally {
      console.error = originalError;
    }
  });

  it("refreshes once after prune evidence regardless of how many refs were recorded", async () => {
    const base = createFakeGit();
    let statusReads = 0;
    const client: GitClient = {
      gitPath: "git",
      invoke: async (options) => {
        const key = options.args.join(" ");

        if (key === "status --porcelain=v2 --branch -z --untracked-files=all") {
          statusReads += 1;
        }

        if (
          key ===
          "for-each-ref --format=%(refname:short)%09%(upstream:remotename)%09%(upstream:remoteref) refs/heads"
        ) {
          return result(
            "main\torigin\trefs/heads/main\nfeature\torigin\trefs/heads/feature\ntopic\torigin\trefs/heads/topic\n",
          );
        }

        if (key === "ls-remote --heads -- origin") {
          return result("abc123\trefs/heads/main\n");
        }

        if (key.startsWith("fetch ") || key.startsWith("update-ref ")) {
          return result("");
        }

        return await base.client.invoke(options);
      },
    };
    const setup = await renderRemoteCommands(client, 1);
    const repository = latestRepository;

    if (repository === undefined) {
      throw new Error("repository probe missing");
    }

    const before = statusReads;

    await act(async () => {
      await runCommand(
        { commandId: "remote.fetchPrune", target: { kind: "none" } },
        {
          state: repository.state,
          signals: repository.signals,
          target: { kind: "none" },
          region: "top-bar",
          client: repository.gitClient,
        },
      );
    });

    expect(statusReads - before).toBe(1);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("performs one evidence refresh when both the pruned and unknown lists are non-empty", async () => {
    const base = createFakeGit();
    let statusReads = 0;
    const client: GitClient = {
      gitPath: "git",
      invoke: async (options) => {
        const key = options.args.join(" ");

        if (key === "status --porcelain=v2 --branch -z --untracked-files=all") {
          statusReads += 1;
        }

        if (
          key ===
          "for-each-ref --format=%(refname:short)%09%(upstream:remotename)%09%(upstream:remoteref) refs/heads"
        ) {
          return result(
            "main\torigin\trefs/heads/main\nfeature\torigin\trefs/heads/feature\nupstream-main\tupstream\trefs/heads/main\n",
          );
        }

        if (key === "ls-remote --heads -- origin") {
          return result("abc123\trefs/heads/main\n");
        }

        if (key === "ls-remote --heads -- upstream") {
          return result("", false);
        }

        if (key.startsWith("fetch ") || key.startsWith("update-ref ")) {
          return result("");
        }

        return await base.client.invoke(options);
      },
    };
    const setup = await renderRemoteCommands(client, 1);
    const repository = latestRepository;

    if (repository === undefined) {
      throw new Error("repository probe missing");
    }

    const before = statusReads;

    await act(async () => {
      await runCommand(
        { commandId: "remote.fetchPrune", target: { kind: "none" } },
        {
          state: repository.state,
          signals: repository.signals,
          target: { kind: "none" },
          region: "top-bar",
          client: repository.gitClient,
        },
      );
    });

    expect(statusReads - before).toBe(1);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("performs one evidence refresh for an unknown-only prune", async () => {
    const base = createFakeGit();
    let statusReads = 0;
    const client: GitClient = {
      gitPath: "git",
      invoke: async (options) => {
        const key = options.args.join(" ");

        if (key === "status --porcelain=v2 --branch -z --untracked-files=all") {
          statusReads += 1;
        }

        if (
          key ===
          "for-each-ref --format=%(refname:short)%09%(upstream:remotename)%09%(upstream:remoteref) refs/heads"
        ) {
          return result("main\torigin\trefs/heads/main\n");
        }

        if (key === "ls-remote --heads -- origin") {
          return result("", false);
        }

        return await base.client.invoke(options);
      },
    };
    const setup = await renderRemoteCommands(client, 1);
    const repository = latestRepository;

    if (repository === undefined) {
      throw new Error("repository probe missing");
    }

    const before = statusReads;

    await act(async () => {
      await runCommand(
        { commandId: "remote.fetchPrune", target: { kind: "none" } },
        {
          state: repository.state,
          signals: repository.signals,
          target: { kind: "none" },
          region: "top-bar",
          client: repository.gitClient,
        },
      );
    });

    expect(statusReads - before).toBe(1);

    await act(async () => {
      await setup.dispose();
    });
  });
});
