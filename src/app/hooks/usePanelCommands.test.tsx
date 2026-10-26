import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { resetCommandOrchestration } from "@/app/hooks/commandRunner.state";
import { usePanelCommands } from "@/app/hooks/usePanelCommands";
import { useRepository } from "@/app/hooks/useRepository";
import { ConfigProvider } from "@/app/providers/ConfigProvider";
import { RepositoryProvider } from "@/app/providers/RepositoryProvider";
import type { RepositoryContextValue } from "@/app/providers/RepositoryProvider.types";
import { resetCommandRunner, runCommand } from "@/domain/commands/commands.runner";
import type {
  CommandFormValues,
  CommandRegion,
  CommandRequest,
  CommandTarget,
} from "@/domain/commands/commands.types";
import { buildListLocalBranchesArgs } from "@/domain/git/git.branches";
import { buildListRemoteBranchesArgs } from "@/domain/git/git.remote-branches";
import type { GitClient, GitInvocationResult } from "@/domain/git/git.types";
import { createFakeGitClient, fakeGitResult } from "@/test/git.fake";

/** Latest repository context captured by the probe. */
let latestRepository: RepositoryContextValue | undefined;

/** Committer date used by the recorded branch fixtures. */
const FIXTURE_DATE = "2026-01-02T00:00:00+00:00";

/** Joined argv of the local branch read. */
const BRANCH_READ_KEY = buildListLocalBranchesArgs().join(" ");

/** Joined argv of the remote-tracking branch read. */
const REMOTE_BRANCH_READ_KEY = buildListRemoteBranchesArgs().join(" ");

/** Local branches where `feature` tracks a remote branch that is absent locally. */
const TRACKING_BRANCHES_OUTPUT = [
  `main\0abc123\0*\0${FIXTURE_DATE}\0origin\0refs/heads/main\0[ahead 2, behind 1]`,
  `feature\0def456\0 \0${FIXTURE_DATE}\0origin\0refs/heads/feature\0`,
].join("\n");

/** Only the current branch's remote-tracking ref exists locally. */
const MAIN_ONLY_REMOTE_BRANCHES_OUTPUT = `refs/remotes/origin/main\0abc123\0${FIXTURE_DATE}\0main\0\n`;

/** One panel command with the values a panel would dispatch. */
interface PanelCommandCase {
  /** Command id. */
  readonly commandId: string;
  /** Explicit target. */
  readonly target: CommandTarget;
  /** Form values the modal would collect. */
  readonly formValues?: CommandFormValues;
  /** Region that dispatches it. */
  readonly region: CommandRegion;
}

/**
 * Narrows one panel command case so each literal is checked on its own.
 *
 * @param testCase - Command case literal.
 * @returns The same case, typed.
 */
function panelCommand(testCase: PanelCommandCase): PanelCommandCase {
  return testCase;
}

/** Every command `usePanelCommands` must register. */
const PANEL_COMMANDS: readonly PanelCommandCase[] = Object.freeze([
  panelCommand({
    commandId: "branch.create",
    target: { kind: "none" },
    formValues: { name: "topic", checkout: "false", startPoint: "" },
    region: "branches",
  }),
  panelCommand({
    commandId: "branch.checkout",
    target: { kind: "branch", name: "feature" },
    region: "branches",
  }),
  panelCommand({
    commandId: "branch.delete",
    target: { kind: "branch", name: "feature" },
    formValues: { scope: "local", force: "false" },
    region: "branches",
  }),
  panelCommand({
    commandId: "remote.createLocal",
    target: { kind: "remoteBranch", remote: "origin", branch: "main" },
    formValues: { name: "local-main", checkout: "false" },
    region: "remotes",
  }),
  panelCommand({
    commandId: "tag.create",
    target: { kind: "none" },
    formValues: { name: "v2.0.0", message: "", target: "" },
    region: "tags",
  }),
  panelCommand({
    commandId: "tag.push",
    target: { kind: "tag", name: "v1.0.0" },
    formValues: { remote: "origin" },
    region: "tags",
  }),
  panelCommand({
    commandId: "tag.delete",
    target: { kind: "tag", name: "v1.0.0" },
    formValues: { scope: "local", remote: "origin" },
    region: "tags",
  }),
  panelCommand({
    commandId: "stash.create",
    target: { kind: "none" },
    formValues: { message: "work", includeUntracked: "false" },
    region: "stashes",
  }),
  panelCommand({
    commandId: "stash.apply",
    target: { kind: "stash", objectName: "aaa111" },
    region: "stashes",
  }),
  panelCommand({
    commandId: "stash.pop",
    target: { kind: "stash", objectName: "aaa111" },
    region: "stashes",
  }),
  panelCommand({
    commandId: "stash.delete",
    target: { kind: "stash", objectName: "aaa111" },
    region: "stashes",
  }),
  panelCommand({
    commandId: "worktree.create",
    target: { kind: "none" },
    formValues: { path: "/repo-topic", mode: "new", branch: "topic" },
    region: "worktrees",
  }),
  panelCommand({
    commandId: "worktree.delete",
    target: { kind: "worktree", path: "/repo-feature" },
    formValues: { force: "false" },
    region: "worktrees",
  }),
]);

/**
 * Wraps a fake client and overrides selected argument arrays.
 *
 * @param base - Base fake client.
 * @param overrides - Answers keyed by the joined argument array.
 * @returns The wrapped client.
 */
function wrapClient(
  base: GitClient,
  overrides: Readonly<Record<string, GitInvocationResult | (() => GitInvocationResult)>>,
): GitClient {
  return {
    gitPath: base.gitPath,
    invoke: async (options) => {
      const answer = overrides[options.args.join(" ")];

      if (answer === undefined) {
        return await base.invoke(options);
      }

      return typeof answer === "function" ? answer() : answer;
    },
  };
}

/** Captures the repository context and installs the panel command handlers. */
function PanelCommandProbe(): ReactNode {
  latestRepository = useRepository();
  usePanelCommands();

  return <text id="panel-probe">probe</text>;
}

/**
 * Reads the latest captured repository context.
 *
 * @returns The context, or undefined before the probe mounts.
 */
function readLatestRepository(): RepositoryContextValue | undefined {
  return latestRepository;
}

/**
 * Renders the repository provider with the panel command probes.
 *
 * @param client - Fake git client.
 * @param probeCount - How many probes mount; two attempt a duplicate registration.
 * @returns The renderer setup.
 */
async function renderPanelCommands(
  client: GitClient,
  probeCount: number = 1,
): Promise<Awaited<ReturnType<typeof testRender>>> {
  latestRepository = undefined;

  const setup = await testRender(
    <ConfigProvider>
      <RepositoryProvider cwd="/repo" gitClient={client} enableWatcher={false} now={() => 5_000}>
        {Array.from({ length: probeCount }, (_, index) => `probe-${index}`).map((id) => (
          <PanelCommandProbe key={id} />
        ))}
      </RepositoryProvider>
    </ConfigProvider>,
    { width: 80, height: 20 },
  );
  const deadline = Date.now() + 2_000;

  for (
    let captured = readLatestRepository();
    captured === undefined || captured.snapshot === null;
  ) {
    if (Date.now() > deadline) {
      break;
    }

    await act(async () => {
      await setup.renderOnce();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    captured = readLatestRepository();
  }

  return setup;
}

/**
 * Runs one panel command through the domain runner.
 *
 * @param testCase - Command id, target, form values, and region.
 * @param repository - Captured repository context.
 * @returns The settled result.
 */
async function runPanelCommand(
  testCase: PanelCommandCase,
  repository: RepositoryContextValue,
): Promise<Awaited<ReturnType<typeof runCommand>>> {
  const request: CommandRequest = {
    commandId: testCase.commandId,
    target: testCase.target,
    formValues: testCase.formValues,
  };

  return await runCommand(request, {
    state: repository.state,
    signals: repository.signals,
    target: testCase.target,
    region: testCase.region,
    client: repository.gitClient,
  });
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

describe("usePanelCommands", () => {
  it("registers every panel handler once and rejects a duplicate mount", async () => {
    const errors: unknown[][] = [];
    const originalError = console.error;

    console.error = (...args: unknown[]): void => {
      errors.push(args);
    };

    try {
      const setup = await renderPanelCommands(createFakeGitClient().client, 2);
      const repository = latestRepository;

      if (repository === undefined) {
        throw new Error("repository probe missing");
      }

      expect(errors).toHaveLength(PANEL_COMMANDS.length);

      try {
        for (const testCase of PANEL_COMMANDS) {
          let outcome: Awaited<ReturnType<typeof runCommand>> | undefined;

          await act(async () => {
            outcome = await runPanelCommand(testCase, repository);
          });

          expect(outcome?.blockedReason, testCase.commandId).not.toBe("command-not-implemented");
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

  it("records a confirmed remote deletion after a local-and-remote branch delete", async () => {
    const base = createFakeGitClient();
    const client = wrapClient(base.client, {
      [BRANCH_READ_KEY]: fakeGitResult(TRACKING_BRANCHES_OUTPUT),
      [REMOTE_BRANCH_READ_KEY]: fakeGitResult(MAIN_ONLY_REMOTE_BRANCHES_OUTPUT),
      "branch -d feature": fakeGitResult(""),
      "push --progress --delete -- origin feature": fakeGitResult(""),
    });
    const setup = await renderPanelCommands(client);
    const repository = latestRepository;

    if (repository === undefined) {
      throw new Error("repository probe missing");
    }

    expect(
      repository.snapshot?.branches.find((branch) => branch.name === "feature")?.upstreamStatus,
    ).toBe("notFound");

    await act(async () => {
      await runPanelCommand(
        {
          commandId: "branch.delete",
          target: { kind: "branch", name: "feature" },
          formValues: { scope: "local-remote", remote: "origin", remoteBranch: "feature" },
          region: "branches",
        },
        repository,
      );
    });

    expect(
      latestRepository?.snapshot?.branches.find((branch) => branch.name === "feature")
        ?.upstreamStatus,
    ).toBe("deleted");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("records nothing when the remote half of a branch delete fails", async () => {
    const base = createFakeGitClient();
    const client = wrapClient(base.client, {
      [BRANCH_READ_KEY]: fakeGitResult(TRACKING_BRANCHES_OUTPUT),
      [REMOTE_BRANCH_READ_KEY]: fakeGitResult(MAIN_ONLY_REMOTE_BRANCHES_OUTPUT),
      "branch -d feature": fakeGitResult(""),
      "push --progress --delete -- origin feature": fakeGitResult("", false, "error: denied"),
    });
    const setup = await renderPanelCommands(client);
    const repository = latestRepository;

    if (repository === undefined) {
      throw new Error("repository probe missing");
    }

    await act(async () => {
      await runPanelCommand(
        {
          commandId: "branch.delete",
          target: { kind: "branch", name: "feature" },
          formValues: { scope: "local-remote", remote: "origin", remoteBranch: "feature" },
          region: "branches",
        },
        repository,
      );
    });

    expect(
      latestRepository?.snapshot?.branches.find((branch) => branch.name === "feature")
        ?.upstreamStatus,
    ).toBe("notFound");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("refreshes remote tag knowledge after a tag push reaches a remote", async () => {
    const base = createFakeGitClient();
    const client = wrapClient(base.client, {
      "push --progress -- origin refs/tags/v1.0.0": fakeGitResult(""),
      "ls-remote --tags -- origin": fakeGitResult("aaaa\trefs/tags/v2.0.0\n"),
    });
    const setup = await renderPanelCommands(client);
    const repository = latestRepository;

    if (repository === undefined) {
      throw new Error("repository probe missing");
    }

    expect(repository.remoteTagChecks.origin?.status).toBe("neverChecked");

    await act(async () => {
      await runPanelCommand(
        {
          commandId: "tag.push",
          target: { kind: "tag", name: "v1.0.0" },
          formValues: { remote: "origin" },
          region: "tags",
        },
        repository,
      );
    });

    expect(latestRepository?.remoteTagChecks.origin).toEqual({
      names: ["v2.0.0"],
      checkedAt: 5_000,
      status: "known",
    });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps tag knowledge untouched when the remote step fails", async () => {
    const base = createFakeGitClient();
    const client = wrapClient(base.client, {
      "push --progress -- origin refs/tags/v1.0.0": fakeGitResult("", false, "error: rejected"),
    });
    const setup = await renderPanelCommands(client);
    const repository = latestRepository;

    if (repository === undefined) {
      throw new Error("repository probe missing");
    }

    await act(async () => {
      await runPanelCommand(
        {
          commandId: "tag.push",
          target: { kind: "tag", name: "v1.0.0" },
          formValues: { remote: "origin" },
          region: "tags",
        },
        repository,
      );
    });

    expect(latestRepository?.remoteTagChecks.origin?.status).toBe("neverChecked");

    await act(async () => {
      await setup.dispose();
    });
  });
});
