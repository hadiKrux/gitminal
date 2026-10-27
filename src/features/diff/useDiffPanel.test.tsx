import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { resetCommandOrchestration } from "@/app/hooks/commandRunner.state";
import {
  getActionRegistryVersion,
  hasRegisteredAction,
  registerAction,
  resetActionRegistry,
  resolveActionHandler,
} from "@/app/hooks/useAction";
import { useHotkeys } from "@/app/hooks/useHotkeys";
import { useOverlay } from "@/app/hooks/useOverlay";
import { useRepository } from "@/app/hooks/useRepository";
import { useStatus } from "@/app/hooks/useStatus";
import { registerCommandHandler, resetCommandRunner } from "@/domain/commands/commands.runner";
import type { CommandRequest } from "@/domain/commands/commands.types";
import {
  buildBinaryProbeArgs,
  buildCommitDiffArgs,
  buildSizeProbeArgs,
  buildStagedDiffArgs,
  buildUntrackedContentArgs,
  buildWorkingDiffArgs,
} from "@/domain/git/git.diff";
import { buildStashDiffArgs } from "@/domain/git/git.stashes";
import type { GitArgPlan, GitClient } from "@/domain/git/git.types";
import { useDiffPanel } from "@/features/diff/useDiffPanel";
import { AppTestProviders } from "@/test/app.harness";
import { createFakeGitClient, fakeGitResult } from "@/test/git.fake";

/** Canonical status with one change per section. */
const STATUS_OUTPUT =
  "# branch.oid abc123\0# branch.head main\0" +
  "1 .M N... 100644 100644 100644 aaaaaaa bbbbbbb unstaged.txt\0" +
  "1 M. N... 100644 100644 100644 aaaaaaa bbbbbbb staged.txt\0" +
  "? untracked.txt\0";

/** A valid working-tree patch for `unstaged.txt`. */
const WORKING_PATCH = [
  "diff --git a/unstaged.txt b/unstaged.txt",
  "--- a/unstaged.txt",
  "+++ b/unstaged.txt",
  "@@ -1,3 +1,4 @@",
  " context",
  "-old line",
  "+new line",
  "+extra line",
  " tail",
  "",
].join("\n");

/** A valid staged patch for `staged.txt`. */
const STAGED_PATCH = [
  "diff --git a/staged.txt b/staged.txt",
  "--- a/staged.txt",
  "+++ b/staged.txt",
  "@@ -1,1 +1,1 @@",
  "-before",
  "+after",
  "",
].join("\n");

/** A valid untracked patch for `untracked.txt`. */
const UNTRACKED_PATCH = [
  "diff --git a/untracked.txt b/untracked.txt",
  "--- /dev/null",
  "+++ b/untracked.txt",
  "@@ -0,0 +1,2 @@",
  "+first",
  "+second",
  "",
].join("\n");

/** A multi-file commit patch. */
const COMMIT_PATCH = [
  "diff --git a/one.txt b/one.txt",
  "--- a/one.txt",
  "+++ b/one.txt",
  "@@ -1,1 +1,2 @@",
  " one",
  "+two",
  "diff --git a/two.txt b/two.txt",
  "--- a/two.txt",
  "+++ b/two.txt",
  "@@ -1,1 +1,1 @@",
  "-old",
  "+new",
  "",
].join("\n");

type PanelHandle = ReturnType<typeof useDiffPanel>;
type OverlayValue = ReturnType<typeof useOverlay>;
type StatusValue = ReturnType<typeof useStatus>;
type RepositoryValue = ReturnType<typeof useRepository>;

let handle: PanelHandle | undefined;
let latestOverlay: OverlayValue | undefined;
let latestStatus: StatusValue | undefined;
let latestRepository: RepositoryValue | undefined;

/**
 * Reads a planned argument array as the fake client's key.
 *
 * @param plan - Planned arguments.
 * @returns The joined key.
 */
function argsOf(plan: GitArgPlan): string {
  if (!plan.ok) {
    throw new Error(plan.error);
  }

  return plan.args.join(" ");
}

/**
 * Creates a fake that answers the diff probes and reads.
 *
 * @param statusOutput - Canonical status output.
 * @returns The fake client and its call log.
 */
function createDiffClient(statusOutput: string = STATUS_OUTPUT) {
  const fake = createFakeGitClient();

  fake.setStatusOutput(statusOutput);

  const calls: string[] = [];
  const answers: Readonly<Record<string, ReturnType<typeof fakeGitResult>>> = {
    [argsOf(buildSizeProbeArgs("unstaged.txt"))]: fakeGitResult("12\n"),
    [argsOf(buildBinaryProbeArgs("working", "unstaged.txt"))]:
      fakeGitResult("1\t1\tunstaged.txt\n"),
    [argsOf(buildWorkingDiffArgs({ path: "unstaged.txt", oldPath: null }, 3))]:
      fakeGitResult(WORKING_PATCH),
    [argsOf(buildSizeProbeArgs("staged.txt"))]: fakeGitResult("10\n"),
    [argsOf(buildBinaryProbeArgs("staged", "staged.txt"))]: fakeGitResult("1\t1\tstaged.txt\n"),
    [argsOf(buildStagedDiffArgs({ path: "staged.txt", oldPath: null }, 3))]:
      fakeGitResult(STAGED_PATCH),
    [argsOf(buildSizeProbeArgs("untracked.txt"))]: fakeGitResult("", false),
    [argsOf(buildBinaryProbeArgs("untracked", "untracked.txt"))]:
      fakeGitResult("2\t0\tuntracked.txt\n"),
    [argsOf(buildUntrackedContentArgs("untracked.txt", 3))]: fakeGitResult(UNTRACKED_PATCH),
    [argsOf(buildCommitDiffArgs("abc123", 3))]: fakeGitResult(COMMIT_PATCH),
    [argsOf(buildStashDiffArgs("stash@{0}", 3))]: fakeGitResult(COMMIT_PATCH),
  };

  const client: GitClient = {
    ...fake.client,
    invoke: async (options) => {
      const key = options.args.join(" ");

      calls.push(key);

      const answer = answers[key];

      return answer ?? (await fake.client.invoke(options));
    },
  };

  return { client, calls, fake };
}

/**
 * Mounts the hook inside a focusable diff region frame.
 *
 * @returns The harness content.
 */
function Harness(): ReactNode {
  handle = useDiffPanel();
  latestOverlay = useOverlay();
  latestStatus = useStatus();
  latestRepository = useRepository();
  useHotkeys();

  return (
    <box {...handle.region.regionProps} flexDirection="column" width={100} height={30}>
      <text>{`rows:${handle.rows.length}`}</text>
    </box>
  );
}

/**
 * Renders the harness with the full provider stack.
 *
 * @param client - Injected git client.
 * @returns The renderer setup.
 */
async function renderHarness(client: GitClient): Promise<Awaited<ReturnType<typeof testRender>>> {
  const setup = await testRender(
    <AppTestProviders gitClient={client}>
      <Harness />
    </AppTestProviders>,
    { width: 120, height: 40, kittyKeyboard: true },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

/**
 * Renders until a predicate holds, or the deadline passes.
 *
 * @param setup - Renderer setup.
 * @param predicate - Condition to wait for.
 */
async function waitFor(
  setup: Awaited<ReturnType<typeof testRender>>,
  predicate: () => boolean,
): Promise<void> {
  const deadline = Date.now() + 2_000;

  while (!predicate() && Date.now() < deadline) {
    await act(async () => {
      await setup.renderOnce();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }

  await act(async () => {
    await setup.renderOnce();
  });
}

/**
 * Focuses the diff region frame.
 *
 * @param setup - Renderer setup.
 */
async function focusDiff(setup: Awaited<ReturnType<typeof testRender>>): Promise<void> {
  await act(async () => {
    setup.renderer.root.findDescendantById("region-diff")?.focus();
  });
  await act(async () => {
    await setup.renderOnce();
  });
}

/**
 * Runs one diff-scoped action.
 *
 * @param actionId - Action id.
 */
async function runAction(actionId: string): Promise<void> {
  await act(async () => {
    resolveActionHandler(actionId, "diff")?.();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

/**
 * Registers a capture-only command handler.
 *
 * @param commandId - Command to capture.
 * @param requests - Captured request list.
 * @returns The registration cleanup.
 */
function registerCapture(commandId: string, requests: CommandRequest[]): () => void {
  return registerCommandHandler({
    commandId,
    operationLabel: commandId,
    handler: async (context) => {
      requests.push(context.request);

      return { steps: [] };
    },
  });
}

beforeEach(() => {
  resetActionRegistry();
  resetCommandRunner();
  resetCommandOrchestration();
  handle = undefined;
  latestOverlay = undefined;
  latestStatus = undefined;
  latestRepository = undefined;
});

describe("useDiffPanel registration and sections", () => {
  it("registers exactly the diff actions plus cursor navigation and no global action", async () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    const versionBefore = getActionRegistryVersion();
    const { client } = createDiffClient();
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.rows.length ?? 0) > 0);

    const expected = [
      "nav.up",
      "nav.down",
      "nav.activate",
      "nav.expand",
      "nav.collapse",
      "diff.toggle",
      "diff.stage",
      "diff.unstage",
      "diff.discard",
      "diff.deleteUntracked",
      "diff.stageAll",
      "diff.unstageAll",
      "diff.discardAll",
      "diff.deleteAllUntracked",
    ];

    for (const actionId of expected) {
      expect(hasRegisteredAction(actionId, "diff"), actionId).toBe(true);
    }

    expect(hasRegisteredAction("nav.first", "diff")).toBe(false);
    expect(hasRegisteredAction("nav.last", "diff")).toBe(false);
    expect(hasRegisteredAction("app.refresh", "diff")).toBe(false);
    expect(hasRegisteredAction("app.refresh", "global")).toBe(false);
    expect(hasRegisteredAction("remote.pull", "diff")).toBe(false);
    expect(getActionRegistryVersion() - versionBefore).toBe(expected.length);
    expect(consoleError).not.toHaveBeenCalled();

    consoleError.mockRestore();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("expands all three sections and the first working file with a text diff", async () => {
    const { client, calls } = createDiffClient();
    const setup = await renderHarness(client);

    await waitFor(setup, () => handle?.fileState(workingFile())?.status === "loaded");

    expect(handle?.expandedSections).toEqual({
      working: true,
      staged: true,
      untracked: true,
    });
    expect(handle?.isFileExpanded(workingFile())).toBe(true);
    expect(calls).toContain(
      argsOf(buildWorkingDiffArgs({ path: "unstaged.txt", oldPath: null }, 3)),
    );

    await act(async () => {
      await setup.dispose();
    });
  });

  it("collapses the auto-expanded file when its diff is binary", async () => {
    const binaryStatus =
      "# branch.oid abc123\0# branch.head main\0" +
      "1 .M N... 100644 100644 100644 aaaaaaa bbbbbbb image.bin\0";
    const fake = createFakeGitClient();

    fake.setStatusOutput(binaryStatus);

    const client: GitClient = {
      ...fake.client,
      invoke: async (options) => {
        const key = options.args.join(" ");

        if (key === argsOf(buildSizeProbeArgs("image.bin"))) {
          return fakeGitResult("20\n");
        }

        if (key === argsOf(buildBinaryProbeArgs("working", "image.bin"))) {
          return fakeGitResult("-\t-\timage.bin\n");
        }

        return await fake.client.invoke(options);
      },
    };
    const setup = await renderHarness(client);

    await waitFor(
      setup,
      () =>
        handle?.fileState({
          id: "working::image.bin",
          section: "working",
          statusLetter: "M",
          status: "modified",
          path: "image.bin",
          oldPath: null,
          conflicted: false,
        })?.status === "binary",
    );
    await waitFor(setup, () => handle?.isFileExpanded(binaryFile()) === false);

    expect(handle?.isFileExpanded(binaryFile())).toBe(false);

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("useDiffPanel bulk targets", () => {
  it("keeps the working section targeted after staging, committing, and editing again", async () => {
    const requests: CommandRequest[] = [];
    const { client, fake } = createDiffClient(
      "# branch.oid abc123\0# branch.head main\0" +
        "1 .M N... 100644 100644 100644 aaaaaaa bbbbbbb unstaged.txt\0",
    );
    const cleanup = registerCommandHandler({
      commandId: "diff.stageAll",
      operationLabel: "Stage all",
      handler: async (context) => {
        requests.push(context.request);
        fake.setStatusOutput(
          "# branch.oid abc123\0# branch.head main\0" +
            "1 M. N... 100644 100644 100644 aaaaaaa bbbbbbb unstaged.txt\0",
        );

        return { steps: [] };
      },
    });
    const setup = await renderHarness(client);

    try {
      await waitFor(setup, () => handle?.rows.length === 4);
      await focusDiff(setup);
      await act(async () => {
        handle?.selectRow("working::unstaged.txt");
      });
      await act(async () => {
        setup.mockInput.pressKey("S");
      });
      await waitFor(setup, () => requests.length === 1 && latestStatus?.operation === null);
      expect(handle?.selectedId).toBe("section::working");

      // A successful commit removes staged paths; the next edit repopulates Working Directory.
      fake.setStatusOutput("# branch.oid def456\0# branch.head main\0");
      await act(async () => {
        await latestRepository?.refreshStatus();
      });
      fake.setStatusOutput(
        "# branch.oid def456\0# branch.head main\0" +
          "1 .M N... 100644 100644 100644 aaaaaaa bbbbbbb unstaged.txt\0",
      );
      await act(async () => {
        await latestRepository?.refreshStatus();
      });
      await focusDiff(setup);
      await act(async () => {
        setup.mockInput.pressKey("S");
      });
      await waitFor(setup, () => requests.length === 2);

      expect(requests).toHaveLength(2);
      expect(requests[1]?.formValues).toEqual({ paths: ["unstaged.txt"] });
    } finally {
      cleanup();
      await act(async () => {
        await setup.dispose();
      });
    }
  });

  it.each(["section::working", "section::staged", "section::untracked", "staged::staged.txt"])(
    "stages all unstaged paths with S when the cursor is on %s",
    async (selectedId) => {
      const requests: CommandRequest[] = [];
      const cleanup = registerCapture("diff.stageAll", requests);
      const { client } = createDiffClient();
      const setup = await renderHarness(client);

      try {
        await waitFor(setup, () => handle?.rows.length === 6);
        await focusDiff(setup);
        await act(async () => {
          handle?.selectRow(selectedId);
        });
        await act(async () => {
          setup.mockInput.pressKey("S");
        });
        await waitFor(setup, () => requests.length === 1);

        expect(requests).toHaveLength(1);
        expect(requests[0]?.formValues).toEqual({ paths: ["unstaged.txt", "untracked.txt"] });
      } finally {
        cleanup();
        await act(async () => {
          await setup.dispose();
        });
      }
    },
  );

  it.each([
    ["? new.txt\0", ["new.txt"]],
    ["", []],
  ] as const)("handles panel-wide staging with status %j", async (status, paths) => {
    const requests: CommandRequest[] = [];
    const cleanup = registerCapture("diff.stageAll", requests);
    const { client } = createDiffClient(`# branch.oid abc123\0# branch.head main\0${status}`);
    const setup = await renderHarness(client);

    try {
      await waitFor(setup, () => handle?.rows.length === 3 + paths.length);
      await focusDiff(setup);
      await act(async () => {
        handle?.selectRow("section::staged");
      });
      await act(async () => {
        setup.mockInput.pressKey("S");
      });
      await waitFor(setup, () => requests.length > 0 || latestStatus?.status?.kind === "warning");

      expect(requests).toHaveLength(paths.length > 0 ? 1 : 0);
      if (paths.length > 0) {
        expect(requests[0]?.formValues).toEqual({ paths: [...paths] });
      } else {
        expect(latestStatus?.status?.kind).toBe("warning");
      }
    } finally {
      cleanup();
      await act(async () => {
        await setup.dispose();
      });
    }
  });

  it("keeps the inline Stage All button scoped to its own section", async () => {
    const requests: CommandRequest[] = [];
    const cleanup = registerCapture("diff.stageAll", requests);
    const { client } = createDiffClient();
    const setup = await renderHarness(client);

    try {
      await waitFor(setup, () => handle?.rows.length === 6);
      const working = handle?.sections.find((view) => view.section === "working");
      expect(working).toBeDefined();

      await act(async () => {
        if (working) {
          handle
            ?.sectionActions(working)
            .find((action) => action.id === "diff.stageAll")
            ?.onPress();
        }
      });
      await waitFor(setup, () => requests.length === 1);

      expect(requests[0]?.formValues).toEqual({ section: "working", paths: ["unstaged.txt"] });
    } finally {
      cleanup();
      await act(async () => {
        await setup.dispose();
      });
    }
  });

  it("stages all unstaged paths while unstage keeps its staged section scope", async () => {
    const requests: CommandRequest[] = [];
    const cleanups = [
      registerCapture("diff.stageAll", requests),
      registerCapture("diff.unstageAll", requests),
    ];
    const { client } = createDiffClient();
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.rows.length ?? 0) === 6);
    await focusDiff(setup);

    await runAction("diff.stageAll");
    await waitFor(setup, () => requests.length === 1);

    expect(requests[0]?.formValues).toEqual({ paths: ["unstaged.txt", "untracked.txt"] });

    await runAction("nav.down");
    await runAction("nav.down");
    await runAction("diff.unstageAll");
    await waitFor(setup, () => requests.length === 2);

    expect(requests[1]?.formValues).toEqual({ section: "staged", paths: ["staged.txt"] });

    for (const cleanup of cleanups) {
      cleanup();
    }

    await act(async () => {
      await setup.dispose();
    });
  });

  it("reports a missing target when a file action runs on a section header", async () => {
    const requests: CommandRequest[] = [];
    const cleanup = registerCapture("diff.stage", requests);
    const { client } = createDiffClient();
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.rows.length ?? 0) === 6);
    await focusDiff(setup);
    await runAction("diff.stage");

    expect(requests).toHaveLength(0);
    expect(latestStatus?.status?.message).toBe("Select an item first");

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("routes the discard key to untracked deletion and uses the exact label", async () => {
    const requests: CommandRequest[] = [];
    const cleanup = registerCapture("diff.deleteUntracked", requests);
    const { client } = createDiffClient();
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.rows.length ?? 0) === 6);
    await focusDiff(setup);

    for (let index = 0; index < 5; index += 1) {
      await runAction("nav.down");
    }

    await runAction("diff.discard");

    const entry = latestOverlay?.entry;

    if (entry?.kind !== "confirm") {
      throw new Error("delete confirmation is not open");
    }

    expect(entry.title).toBe("Delete untracked file");
    expect(entry.confirmLabel).toBe("Delete untracked file");
    expect(entry.destructive).toBe(true);
    expect(entry.description).toContain("removed from disk");

    await act(async () => {
      entry.onConfirm();
    });
    await waitFor(setup, () => requests.length === 1);

    expect(requests[0]?.commandId).toBe("diff.deleteUntracked");
    expect(requests[0]?.target).toEqual({
      kind: "diffFile",
      section: "untracked",
      path: "untracked.txt",
    });

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("names the count in the bulk untracked delete confirmation", async () => {
    const { client } = createDiffClient();
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.rows.length ?? 0) === 6);
    await focusDiff(setup);

    for (let index = 0; index < 4; index += 1) {
      await runAction("nav.down");
    }

    await runAction("diff.deleteAllUntracked");

    const entry = latestOverlay?.entry;

    if (entry?.kind !== "confirm") {
      throw new Error("bulk delete confirmation is not open");
    }

    expect(entry.title).toBe("Delete all untracked files");
    expect(entry.confirmLabel).toBe("Delete 1 untracked file");
    expect(entry.destructive).toBe(true);
    expect(entry.description).toContain("removed from disk");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps a tracked file on diff.discard", async () => {
    const requests: CommandRequest[] = [];
    const cleanup = registerCapture("diff.discard", requests);
    const { client } = createDiffClient();
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.rows.length ?? 0) === 6);
    await focusDiff(setup);
    await runAction("nav.down");
    await runAction("diff.discard");

    const entry = latestOverlay?.entry;

    if (entry?.kind !== "confirm") {
      throw new Error("discard confirmation is not open");
    }

    expect(entry.title).toBe("Discard changes");
    expect(entry.confirmLabel).toBe("Discard changes");
    expect(entry.description).toContain("index version");

    await act(async () => {
      entry.onConfirm();
    });
    await waitFor(setup, () => requests.length === 1);

    expect(requests[0]?.commandId).toBe("diff.discard");

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("useDiffPanel selection", () => {
  it.each([
    ["working", "unstaged.txt"],
    ["staged", "staged.txt"],
    ["untracked", "untracked.txt"],
  ])("keeps a disappearing %s file's cursor in its section", async (section, path) => {
    const { client, fake } = createDiffClient();
    const setup = await renderHarness(client);

    try {
      await waitFor(setup, () => handle?.rows.length === 6);
      await focusDiff(setup);
      await act(async () => {
        handle?.selectRow(`${section}::${path}`);
      });
      expect(handle?.selectedId).toBe(`${section}::${path}`);

      fake.setStatusOutput("# branch.oid abc123\0# branch.head main\0");
      await act(async () => {
        await latestRepository?.refreshStatus();
      });

      expect(handle?.selectedId).toBe(`section::${section}`);

      fake.setStatusOutput(STATUS_OUTPUT);
      await act(async () => {
        await latestRepository?.refreshStatus();
      });

      expect(handle?.selectedId).toBe(`section::${section}`);
    } finally {
      await act(async () => {
        await setup.dispose();
      });
    }
  });

  it("restores the remembered file when its section expands again", async () => {
    const { client } = createDiffClient();
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.rows.length ?? 0) === 6);
    await focusDiff(setup);
    await runAction("nav.down");

    expect(handle?.selectedId).toBe("working::unstaged.txt");

    await runAction("nav.up");
    await runAction("nav.collapse");

    expect(handle?.expandedSections.working).toBe(false);

    await runAction("nav.expand");
    await waitFor(setup, () => handle?.selectedId === "working::unstaged.txt");

    expect(handle?.selectedId).toBe("working::unstaged.txt");
    expect(handle?.expandedSections.working).toBe(true);

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("useDiffPanel read-only mode", () => {
  it("renders a commit as one read-only list with every action unavailable", async () => {
    const requests: CommandRequest[] = [];
    const cleanups = [
      registerCapture("diff.stage", requests),
      registerCapture("diff.discardAll", requests),
    ];
    const { client } = createDiffClient();
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.rows.length ?? 0) === 6);

    await act(async () => {
      latestRepository?.setSelection({ kind: "commit", oid: "abc123" });
    });
    await waitFor(setup, () => handle?.readOnlyState.status === "loaded");

    expect(handle?.readOnly).toBe(true);
    expect(handle?.readOnlyTitle).toBe("Commit abc123");
    expect(handle?.readOnlyFiles.map((file) => file.path)).toEqual(["one.txt", "two.txt"]);
    expect(handle?.rows.map((row) => row.id)).toEqual(["readonly::one.txt", "readonly::two.txt"]);

    const firstFile = handle?.readOnlyFiles[0];

    expect(firstFile === undefined ? null : handle?.fileActions(firstFile)).toEqual([]);

    await focusDiff(setup);
    await runAction("diff.stage");
    await runAction("diff.discardAll");

    expect(requests).toHaveLength(0);
    expect(latestStatus?.status?.message).toBe("read-only");

    for (const cleanup of cleanups) {
      cleanup();
    }

    await act(async () => {
      await setup.dispose();
    });
  });

  it("reads the selected stash through the current selector", async () => {
    const { client, calls } = createDiffClient();
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.rows.length ?? 0) === 6);

    await act(async () => {
      latestRepository?.setSelection({ kind: "stash", objectName: "aaa111" });
    });
    await waitFor(setup, () => handle?.readOnlyState.status === "loaded");

    expect(handle?.readOnlyTitle).toContain("Stash");
    expect(calls).toContain(argsOf(buildStashDiffArgs("stash@{0}", 3)));

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("useDiffPanel duplicate registration", () => {
  it("rejects a second handler for an action already owned by the panel", async () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    const { client } = createDiffClient();
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.rows.length ?? 0) > 0);

    const cleanup = registerAction("diff.stage", { scope: "diff" }, () => {});

    expect(consoleError).toHaveBeenCalled();

    cleanup();
    consoleError.mockRestore();
    await act(async () => {
      await setup.dispose();
    });
  });
});

/**
 * Builds the first working file row for assertions.
 *
 * @returns The row model.
 */
function workingFile() {
  return {
    id: "working::unstaged.txt",
    section: "working" as const,
    statusLetter: "M" as const,
    status: "modified" as const,
    path: "unstaged.txt",
    oldPath: null,
    conflicted: false,
  };
}

/**
 * Builds the binary working file row for assertions.
 *
 * @returns The row model.
 */
function binaryFile() {
  return {
    id: "working::image.bin",
    section: "working" as const,
    statusLetter: "M" as const,
    status: "modified" as const,
    path: "image.bin",
    oldPath: null,
    conflicted: false,
  };
}
