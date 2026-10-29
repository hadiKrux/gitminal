import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode, useState } from "react";
import { resetCommandOrchestration } from "@/app/hooks/commandRunner.state";
import { useOverlay } from "@/app/hooks/useOverlay";
import { useStatus } from "@/app/hooks/useStatus";
import { registerCommandHandler, resetCommandRunner } from "@/domain/commands/commands.runner";
import type {
  CommandAvailability,
  CommandRequest,
  CommandTarget,
} from "@/domain/commands/commands.types";
import type { RemoteFetchScope } from "@/domain/config/config.types";
import type { GitClient } from "@/domain/git/git.types";
import type { TopBarCommands } from "@/features/top-bar/useTopBar.types";
import { readAutoCreatedUpstream, useTopBarCommands } from "@/features/top-bar/useTopBarCommands";
import { AppTestProviders } from "@/test/app.harness";
import { createFakeGitClient } from "@/test/git.fake";

/** Latest overlay context captured by the harness. */
let latestOverlay: ReturnType<typeof useOverlay> | undefined;

/** Latest status context captured by the harness. */
let latestStatus: ReturnType<typeof useStatus> | undefined;

/** Latest command router captured by the harness. */
let latestCommands: TopBarCommands | undefined;

/** Switches the branch the harness reports. */
let setBranch: (branch: string) => void = () => {};

/** Switches the upstream ref the harness reports. */
let setUpstream: (upstreamRef: string | null) => void = () => {};

/** Switches the effective fetch scope the harness reports. */
let setFetchScope: (fetchScope: RemoteFetchScope) => void = () => {};

/** Handler invocations recorded for the force push. */
let handlerCalls = 0;

/** Targets reported to the recorded handler. */
let handlerTargets: CommandTarget[] = [];

/** Availability reader that lets the confirmation open in every case. */
const ALWAYS_AVAILABLE = (): CommandAvailability => ({ available: true });

/**
 * Captures the command router and its providers.
 *
 * @returns A non-focusable marker.
 */
function CommandsProbe(): ReactNode {
  const [branch, setCurrentBranch] = useState("main");
  const [upstreamRef, setCurrentUpstream] = useState<string | null>("origin/main");
  const [fetchScope, setCurrentFetchScope] = useState<RemoteFetchScope>("local");

  setBranch = setCurrentBranch;
  setUpstream = setCurrentUpstream;
  setFetchScope = setCurrentFetchScope;
  latestOverlay = useOverlay();
  latestStatus = useStatus();
  latestCommands = useTopBarCommands({
    branch,
    upstreamRef,
    fetchScope,
    getAvailability: ALWAYS_AVAILABLE,
  });

  return <text id="commands-probe">probe</text>;
}

/**
 * Renders the command probe inside the provider stack it needs.
 *
 * @returns The renderer setup and the fake client.
 */
async function renderCommands(client?: GitClient): Promise<{
  setup: Awaited<ReturnType<typeof testRender>>;
  fake: ReturnType<typeof createFakeGitClient>;
}> {
  latestOverlay = undefined;
  latestStatus = undefined;
  latestCommands = undefined;
  handlerCalls = 0;
  handlerTargets = [];
  setBranch = () => {};
  setUpstream = () => {};
  setFetchScope = () => {};

  const fake = createFakeGitClient();
  const setup = await testRender(
    <AppTestProviders gitClient={client ?? fake.client}>
      <CommandsProbe />
    </AppTestProviders>,
    { width: 80, height: 10 },
  );
  const deadline = Date.now() + 2_000;

  while (
    (client === undefined
      ? (fake.counts.get("status --porcelain=v2 --branch -z --untracked-files=all") ?? 0) === 0
      : latestCommands === undefined) &&
    Date.now() < deadline
  ) {
    if (Date.now() > deadline) {
      throw new Error("initial read did not settle");
    }

    await act(async () => {
      await setup.renderOnce();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }

  return { setup, fake };
}

beforeEach(() => {
  resetCommandRunner();
  resetCommandOrchestration();
  handlerCalls = 0;
});

afterEach(() => {
  resetCommandRunner();
  resetCommandOrchestration();
});

describe("useTopBarCommands fetch form values", () => {
  it("carries scope and branch only for the distinct prune command", async () => {
    const requests: CommandRequest[] = [];
    const commandIds = [
      "remote.fetch",
      "remote.fetchPrune",
      "remote.pull",
      "remote.push",
      "remote.pushNoVerify",
    ];
    const cleanups = commandIds.map((commandId) =>
      registerCommandHandler({
        commandId,
        operationLabel: commandId,
        handler: async (context) => {
          requests.push(context.request);

          return { steps: [] };
        },
      }),
    );
    const { setup } = await renderCommands();

    await act(async () => {
      setFetchScope("current");
      await setup.renderOnce();
    });

    for (const commandId of commandIds) {
      await act(async () => {
        latestCommands?.dispatch(commandId);
        await new Promise((resolve) => setTimeout(resolve, 40));
      });
    }

    expect(requests.map((request) => [request.commandId, request.formValues])).toEqual([
      ["remote.fetch", undefined],
      ["remote.fetchPrune", { fetchScope: "current", branch: "main" }],
      ["remote.pull", undefined],
      ["remote.push", undefined],
      ["remote.pushNoVerify", undefined],
    ]);

    for (const cleanup of cleanups) {
      cleanup();
    }

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("readAutoCreatedUpstream", () => {
  it("reads the remote and branch from the argv that actually ran", () => {
    const result = {
      commandId: "remote.push",
      status: "success" as const,
      operationLabel: "Push",
      cwd: "/repo",
      progress: [],
      steps: [
        {
          argv: [
            "git",
            "push",
            "--progress",
            "--set-upstream",
            "origin",
            "refs/heads/feature/x:refs/heads/feature/x",
          ],
          exitCode: 0,
          durationMs: 1,
          stdout: "",
          stderr: "",
        },
      ],
    };

    expect(readAutoCreatedUpstream(result)).toEqual({
      remote: "origin",
      branch: "feature/x",
    });
    expect(
      readAutoCreatedUpstream({
        ...result,
        steps: [
          {
            argv: ["git", "push", "--progress"],
            exitCode: 0,
            durationMs: 1,
            stdout: "",
            stderr: "",
          },
        ],
      }),
    ).toBeNull();
  });
});

describe("useTopBarCommands force confirmation", () => {
  it("runs the captured target when the branch has not changed", async () => {
    const cleanup = registerCommandHandler({
      commandId: "remote.pushForceOverwrite",
      operationLabel: "Overwrite remote",
      handler: async (context) => {
        handlerCalls += 1;
        handlerTargets.push(context.target);

        return { steps: [] };
      },
    });
    const { setup } = await renderCommands();

    await act(async () => {
      latestCommands?.activateCommand("remote.pushForceOverwrite");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    const description =
      latestOverlay?.entry?.kind === "confirm" ? latestOverlay.entry.description : "";

    expect(latestOverlay?.entry?.kind).toBe("confirm");
    expect(description).toContain("main -> origin/main");

    await act(async () => {
      if (latestOverlay?.entry?.kind === "confirm") {
        latestOverlay.entry.onConfirm();
      }

      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    expect(handlerCalls).toBe(1);
    expect(handlerTargets).toEqual([{ kind: "branch", name: "main" }]);
    expect(latestOverlay?.entry).toBeNull();

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("dispatches the explicit current-branch target for a non-confirmed command", async () => {
    const cleanup = registerCommandHandler({
      commandId: "remote.pushNoVerify",
      operationLabel: "Push without hooks",
      handler: async (context) => {
        handlerTargets.push(context.target);

        return { steps: [] };
      },
    });
    const { setup } = await renderCommands();

    await act(async () => {
      latestCommands?.dispatch("remote.pushNoVerify");
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(handlerTargets).toEqual([{ kind: "branch", name: "main" }]);

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("reports the upstream that the auto-creating push actually set", async () => {
    const cleanup = registerCommandHandler({
      commandId: "remote.push",
      operationLabel: "Push",
      handler: async () => ({
        steps: [
          {
            argv: [
              "git",
              "push",
              "--progress",
              "--set-upstream",
              "origin",
              "refs/heads/main:refs/heads/main",
            ],
            exitCode: 0,
            durationMs: 1,
            stdout: "",
            stderr: "",
          },
        ],
      }),
    });
    const { setup } = await renderCommands();

    await act(async () => {
      latestCommands?.dispatch("remote.push");
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(latestStatus?.status).toEqual({
      kind: "success",
      message: "Pushed main; tracking origin/main",
    });

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("closes and warns instead of running when the branch changes while open", async () => {
    const cleanup = registerCommandHandler({
      commandId: "remote.pushForceOverwrite",
      operationLabel: "Overwrite remote",
      handler: async (context) => {
        handlerCalls += 1;
        handlerTargets.push(context.target);

        return { steps: [] };
      },
    });
    const { setup } = await renderCommands();

    await act(async () => {
      latestCommands?.activateCommand("remote.pushForceOverwrite");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestOverlay?.entry?.kind).toBe("confirm");

    await act(async () => {
      setBranch("other");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      if (latestOverlay?.entry?.kind === "confirm") {
        latestOverlay.entry.onConfirm();
      }

      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    expect(handlerCalls).toBe(0);
    expect(latestOverlay?.entry).toBeNull();
    expect(latestStatus?.status).toEqual({
      kind: "warning",
      message: "branch or upstream changed; open the confirmation again",
    });

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("closes and warns when only the upstream changes while open", async () => {
    const cleanup = registerCommandHandler({
      commandId: "remote.pushForceOverwrite",
      operationLabel: "Overwrite remote",
      handler: async (context) => {
        handlerCalls += 1;
        handlerTargets.push(context.target);

        return { steps: [] };
      },
    });
    const { setup } = await renderCommands();

    await act(async () => {
      latestCommands?.activateCommand("remote.pushForceOverwrite");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestOverlay?.entry?.kind).toBe("confirm");

    await act(async () => {
      setUpstream("origin/other");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      if (latestOverlay?.entry?.kind === "confirm") {
        latestOverlay.entry.onConfirm();
      }

      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    expect(handlerCalls).toBe(0);
    expect(latestOverlay?.entry).toBeNull();
    expect(latestStatus?.status).toEqual({
      kind: "warning",
      message: "branch or upstream changed; open the confirmation again",
    });

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("consumes a rejecting orchestration so it never becomes an unhandled rejection", async () => {
    const cleanup = registerCommandHandler({
      commandId: "remote.pushNoVerify",
      operationLabel: "Push without hooks",
      handler: async () => ({ steps: [] }),
    });
    const base = createFakeGitClient();
    let failRefresh = false;
    const client: GitClient = {
      gitPath: "git",
      invoke: async (options) => {
        if (failRefresh && options.args[0] === "status") {
          throw new Error("refresh exploded");
        }

        return await base.client.invoke(options);
      },
    };
    const { setup } = await renderCommands(client);
    const rejections: unknown[] = [];
    const listener = (reason: unknown): void => {
      rejections.push(reason);
    };

    const deadline = Date.now() + 2_000;

    while (
      (base.counts.get("status --porcelain=v2 --branch -z --untracked-files=all") ?? 0) === 0 &&
      Date.now() < deadline
    ) {
      await act(async () => {
        await setup.renderOnce();
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
    }

    process.on("unhandledRejection", listener);

    try {
      await act(async () => {
        failRefresh = true;
        latestCommands?.dispatch("remote.pushNoVerify");
        await new Promise((resolve) => setTimeout(resolve, 30));
      });

      expect(latestOverlay?.errorDetail?.message).toBe("refresh exploded");
      expect(latestStatus?.status).toBeNull();
      expect(rejections).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", listener);
    }

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });
});
