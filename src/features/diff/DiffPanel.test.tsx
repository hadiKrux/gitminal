import { beforeEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { resetCommandOrchestration } from "@/app/hooks/commandRunner.state";
import { resetActionRegistry, resolveActionHandler } from "@/app/hooks/useAction";
import { useHotkeys } from "@/app/hooks/useHotkeys";
import { useRepository } from "@/app/hooks/useRepository";
import { registerCommandHandler, resetCommandRunner } from "@/domain/commands/commands.runner";
import {
  buildBinaryProbeArgs,
  buildCommitDiffArgs,
  buildSizeProbeArgs,
  buildStagedDiffArgs,
  buildUntrackedContentArgs,
  buildWorkingDiffArgs,
} from "@/domain/git/git.diff";
import type { GitArgPlan, GitClient, GitInvocationResult } from "@/domain/git/git.types";
import { DiffPanel } from "@/features/diff/DiffPanel";
import { AppTestProviders } from "@/test/app.harness";
import { createFakeGitClient, fakeGitResult } from "@/test/git.fake";

/** Canonical status with one change per section. */
const STATUS_OUTPUT =
  "# branch.oid abc123\0# branch.head main\0" +
  "1 .M N... 100644 100644 100644 aaaaaaa bbbbbbb unstaged.txt\0" +
  "1 M. N... 100644 100644 100644 aaaaaaa bbbbbbb staged.txt\0" +
  "? untracked.txt\0";

/** Canonical status for a conflicted merge. */
const CONFLICT_STATUS =
  "# branch.oid abc123\0# branch.head main\0" +
  "u UU N... 100644 100644 100644 100644 aaaaaaa bbbbbbb ccccccc conflict.txt\0";

/** Canonical status for a staged rename. */
const RENAME_STATUS =
  "# branch.oid abc123\0# branch.head main\0" +
  "2 R. N... 100644 100644 100644 aaaaaaa bbbbbbb R100 new.txt\0old.txt\0";

/** Working patch for `unstaged.txt`. */
const WORKING_PATCH = [
  "diff --git a/unstaged.txt b/unstaged.txt",
  "--- a/unstaged.txt",
  "+++ b/unstaged.txt",
  "@@ -1,3 +1,4 @@",
  " context",
  "-old line",
  "+new line",
  " extra",
  " tail",
  "",
].join("\n");

/** Working patch for `unstaged.txt` after an external edit. */
const REFRESHED_WORKING_PATCH = [
  "diff --git a/unstaged.txt b/unstaged.txt",
  "--- a/unstaged.txt",
  "+++ b/unstaged.txt",
  "@@ -1,3 +1,4 @@",
  " context",
  "-old line",
  "+fresh line",
  " extra",
  " tail",
  "",
].join("\n");

/** Staged patch for `staged.txt`. */
const STAGED_PATCH = [
  "diff --git a/staged.txt b/staged.txt",
  "--- a/staged.txt",
  "+++ b/staged.txt",
  "@@ -1,1 +1,1 @@",
  "-before",
  "+after",
  "",
].join("\n");

/** Untracked patch for `untracked.txt`. */
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

type RepositoryValue = ReturnType<typeof useRepository>;

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
 * Creates a fake that answers the diff reads for the standard status.
 *
 * @param statusOutput - Canonical status output.
 * @param extraAnswers - Additional answers keyed by joined argv.
 * @returns The fake client.
 */
function createDiffClient(
  statusOutput: string = STATUS_OUTPUT,
  extraAnswers: Readonly<Record<string, () => GitInvocationResult>> = {},
) {
  const fake = createFakeGitClient();

  fake.setStatusOutput(statusOutput);

  const answers: Readonly<Record<string, () => GitInvocationResult>> = {
    [argsOf(buildSizeProbeArgs("unstaged.txt"))]: () => fakeGitResult("12\n"),
    [argsOf(buildBinaryProbeArgs("working", "unstaged.txt"))]: () =>
      fakeGitResult("1\t1\tunstaged.txt\n"),
    [argsOf(buildWorkingDiffArgs({ path: "unstaged.txt", oldPath: null }, 3))]: () =>
      fakeGitResult(WORKING_PATCH),
    [argsOf(buildSizeProbeArgs("staged.txt"))]: () => fakeGitResult("9\n"),
    [argsOf(buildBinaryProbeArgs("staged", "staged.txt"))]: () =>
      fakeGitResult("1\t1\tstaged.txt\n"),
    [argsOf(buildStagedDiffArgs({ path: "staged.txt", oldPath: null }, 3))]: () =>
      fakeGitResult(STAGED_PATCH),
    [argsOf(buildSizeProbeArgs("untracked.txt"))]: () => fakeGitResult("", false),
    [argsOf(buildBinaryProbeArgs("untracked", "untracked.txt"))]: () =>
      fakeGitResult("2\t0\tuntracked.txt\n"),
    [argsOf(buildUntrackedContentArgs("untracked.txt", 3))]: () => fakeGitResult(UNTRACKED_PATCH),
    [argsOf(buildCommitDiffArgs("abc123", 3))]: () => fakeGitResult(COMMIT_PATCH),
    ...extraAnswers,
  };

  const client: GitClient = {
    ...fake.client,
    invoke: async (options) => {
      const answer = answers[options.args.join(" ")];

      return answer === undefined ? await fake.client.invoke(options) : answer();
    },
  };

  return { client, fake };
}

/**
 * Reports the repository selection reader and installs the key dispatcher.
 *
 * @param props - Pane width and height.
 * @returns The panel.
 */
function PanelSurface(props: { readonly width: number; readonly height: number }): ReactNode {
  latestRepository = useRepository();
  useHotkeys();

  return (
    <box flexDirection="column" width={props.width} height={props.height}>
      <DiffPanel />
    </box>
  );
}

/**
 * Mounts the panel inside the full provider stack.
 *
 * @param props - Injected git client and pane size.
 * @returns The harness content.
 */
function PanelHarness(props: {
  readonly client: GitClient;
  readonly width: number;
  readonly height: number;
}): ReactNode {
  return (
    <AppTestProviders gitClient={props.client}>
      <PanelSurface width={props.width} height={props.height} />
    </AppTestProviders>
  );
}

/**
 * Renders the panel.
 *
 * @param client - Injected git client.
 * @param size - Pane and terminal dimensions.
 * @returns The renderer setup.
 */
async function renderPanel(
  client: GitClient,
  size: {
    readonly width?: number;
    readonly height?: number;
    readonly terminalWidth?: number;
    readonly terminalHeight?: number;
  } = {},
): Promise<Awaited<ReturnType<typeof testRender>>> {
  const width = size.width ?? 100;
  const height = size.height ?? 30;
  const setup = await testRender(<PanelHarness client={client} width={width} height={height} />, {
    width: size.terminalWidth ?? 120,
    height: size.terminalHeight ?? 40,
    kittyKeyboard: true,
  });

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
 * Captures the current frame, tolerating a transient native buffer lease.
 *
 * The OpenTUI test renderer can refuse a capture while a render pass is still settling. A retry on
 * the next awaited turn is enough, so the helper reports an empty frame instead of failing the test
 * on a transient native error.
 *
 * @param setup - Renderer setup.
 * @returns The captured frame, or an empty string when the capture was busy.
 */
function readFrame(setup: Awaited<ReturnType<typeof testRender>>): string {
  try {
    return setup.captureCharFrame();
  } catch {
    return "";
  }
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

beforeEach(() => {
  resetActionRegistry();
  resetCommandRunner();
  resetCommandOrchestration();
  latestRepository = undefined;
});

describe("DiffPanel layout", () => {
  it("renders the three sections in F-11 order with expanded defaults", async () => {
    const { client } = createDiffClient();
    const setup = await renderPanel(client);

    await waitFor(setup, () => readFrame(setup).includes("new line"));

    const frame = readFrame(setup);
    const working = frame.indexOf("Working Directory");
    const staged = frame.indexOf("Staged Files");
    const untracked = frame.indexOf("Untracked Files");

    expect(working).toBeGreaterThanOrEqual(0);
    expect(staged).toBeGreaterThan(working);
    expect(untracked).toBeGreaterThan(staged);
    expect(frame).toContain("unstaged.txt");
    expect(frame).toContain("staged.txt");
    expect(frame).toContain("untracked.txt");
    expect(frame).toContain("new line");
    expect(frame).toContain("old line");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("re-reads an expanded diff after a repository refresh invalidates the cache", async () => {
    const workingKey = argsOf(buildWorkingDiffArgs({ path: "unstaged.txt", oldPath: null }, 3));
    let reads = 0;
    const { client } = createDiffClient(STATUS_OUTPUT, {
      [workingKey]: () => {
        reads += 1;

        return fakeGitResult(reads === 1 ? WORKING_PATCH : REFRESHED_WORKING_PATCH);
      },
    });
    const setup = await renderPanel(client);

    await waitFor(setup, () => readFrame(setup).includes("old line"));

    expect(reads).toBe(1);

    await act(async () => {
      await latestRepository?.refreshStatus();
    });

    await waitFor(setup, () => readFrame(setup).includes("fresh line"));

    expect(reads).toBe(2);
    expect(readFrame(setup)).toContain("fresh line");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("renders the per-section empty messages", async () => {
    const { client } = createDiffClient("# branch.oid abc123\0# branch.head main\0");
    const setup = await renderPanel(client);

    await waitFor(setup, () => readFrame(setup).includes("No unstaged changes"));
    const frame = readFrame(setup);

    expect(frame).toContain("No unstaged changes");
    expect(frame).toContain("No staged changes");
    expect(frame).toContain("No untracked files");
    expect(frame).toContain("no files");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("renders a rename as old -> new", async () => {
    const { client } = createDiffClient(RENAME_STATUS);
    const setup = await renderPanel(client);

    await waitFor(setup, () => readFrame(setup).includes("old.txt -> new.txt"));

    expect(readFrame(setup)).toContain("old.txt -> new.txt");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the truncated path and counts inside a narrow panel with a scrollbar", async () => {
    const longPath = "src/features/very-long-directory-name/deep/nested/file.txt";
    const filePaths = [
      longPath,
      ...Array.from({ length: 12 }, (_, index) => `src/file-${index}.txt`),
    ];
    const status =
      "# branch.oid abc123\0# branch.head main\0" +
      filePaths.map((path) => `1 .M N... 100644 100644 100644 aaaaaaa bbbbbbb ${path}\0`).join("");
    const patch = [
      `diff --git a/${longPath} b/${longPath}`,
      `--- a/${longPath}`,
      `+++ b/${longPath}`,
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
      "",
    ].join("\n");
    const { client } = createDiffClient(status, {
      [argsOf(buildSizeProbeArgs(longPath))]: () => fakeGitResult("12\n"),
      [argsOf(buildBinaryProbeArgs("working", longPath))]: () =>
        fakeGitResult(`1\t1\t${longPath}\n`),
      [argsOf(buildWorkingDiffArgs({ path: longPath, oldPath: null }, 3))]: () =>
        fakeGitResult(patch),
    });
    const setup = await renderPanel(client, {
      width: 40,
      height: 12,
      terminalWidth: 80,
      terminalHeight: 20,
    });

    await waitFor(
      setup,
      () => readFrame(setup).includes("src/features") && readFrame(setup).includes("+1"),
    );

    const line =
      readFrame(setup)
        .split("\n")
        .find((row) => row.includes("src/features")) ?? "";
    const visible = line.slice(0, 40);

    expect(visible).toContain("...");
    expect(visible).toContain("+1");
    expect(visible).toContain("-1");

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("DiffPanel notices", () => {
  it("shows the binary notice when a binary file is expanded", async () => {
    const { client } = createDiffClient(
      "# branch.oid abc123\0# branch.head main\0" +
        "1 .M N... 100644 100644 100644 aaaaaaa bbbbbbb image.bin\0",
      {
        [argsOf(buildSizeProbeArgs("image.bin"))]: () => fakeGitResult("20\n"),
        [argsOf(buildBinaryProbeArgs("working", "image.bin"))]: () =>
          fakeGitResult("-\t-\timage.bin\n"),
      },
    );
    const setup = await renderPanel(client);

    await waitFor(setup, () => readFrame(setup).includes("image.bin"));
    await focusDiff(setup);
    await runAction("nav.down");
    await runAction("diff.toggle");

    await waitFor(setup, () => readFrame(setup).includes("Binary file - preview unavailable"));

    expect(readFrame(setup)).toContain("Binary file - preview unavailable");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows the oversized notice with the size", async () => {
    const { client } = createDiffClient(
      "# branch.oid abc123\0# branch.head main\0" +
        "1 M. N... 100644 100644 100644 aaaaaaa bbbbbbb huge.txt\0",
      {
        [argsOf(buildSizeProbeArgs("huge.txt"))]: () => fakeGitResult("2097152\n"),
        [argsOf(buildBinaryProbeArgs("staged", "huge.txt"))]: () =>
          fakeGitResult("1\t1\thuge.txt\n"),
      },
    );
    const setup = await renderPanel(client);

    await waitFor(setup, () => readFrame(setup).includes("huge.txt"));
    await focusDiff(setup);
    await runAction("nav.down");
    await runAction("nav.down");
    await runAction("diff.toggle");

    await waitFor(setup, () => readFrame(setup).includes("File too large to preview"));

    expect(readFrame(setup)).toContain("File too large to preview");
    expect(readFrame(setup)).toContain("2.0 MB");

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("DiffPanel read-only and gated states", () => {
  it("renders a commit read-only with expanded content and no actions", async () => {
    const { client } = createDiffClient();
    const setup = await renderPanel(client);

    await waitFor(setup, () => (latestRepository?.snapshot?.status?.entries.length ?? 0) === 3);

    await act(async () => {
      latestRepository?.setSelection({ kind: "commit", oid: "abc123" });
    });
    await waitFor(setup, () => readFrame(setup).includes("Commit abc123"));

    const frame = readFrame(setup);

    expect(frame).toContain("one.txt");
    expect(frame).toContain("two.txt");
    expect(frame).toContain("two");
    expect(frame).not.toContain("Working Directory");
    expect(frame).not.toContain("Stage All");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps a settled commit diff across a graph-window refresh", async () => {
    let commitReads = 0;
    const { client } = createDiffClient(STATUS_OUTPUT, {
      [argsOf(buildCommitDiffArgs("abc123", 3))]: () => {
        commitReads += 1;

        return fakeGitResult(COMMIT_PATCH);
      },
      [argsOf(buildCommitDiffArgs("def456", 3))]: () => {
        commitReads += 1;

        return fakeGitResult(COMMIT_PATCH);
      },
    });
    const setup = await renderPanel(client);

    await waitFor(setup, () => (latestRepository?.snapshot?.status?.entries.length ?? 0) === 3);
    await act(async () => {
      latestRepository?.setSelection({ kind: "commit", oid: "abc123" });
    });
    await waitFor(setup, () => commitReads === 1);

    await act(async () => {
      await latestRepository?.refreshGraphWindow();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(commitReads).toBe(1);
    expect(readFrame(setup)).toContain("two");

    await act(async () => {
      latestRepository?.setSelection({ kind: "commit", oid: "def456" });
    });
    await waitFor(setup, () => commitReads === 2);

    expect(commitReads).toBe(2);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows the merge banner and disables bulk staging", async () => {
    const { client } = createDiffClient(CONFLICT_STATUS, {
      "rev-parse --verify --quiet MERGE_HEAD": () => fakeGitResult("merge-head\n"),
    });
    const setup = await renderPanel(client);

    await waitFor(setup, () => readFrame(setup).includes("Merge in progress"));

    const frame = readFrame(setup);

    expect(frame).toContain("Merge in progress");
    expect(frame).toContain("Conflicts in 1 file");
    expect(frame).toContain("conflict.txt");
    expect(frame).toContain("Another operation is in progress");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows the operation banner while a write runs", async () => {
    registerCommandHandler({
      commandId: "diff.stage",
      operationLabel: "Stage file",
      handler: async () => await new Promise(() => {}),
    });

    const { client } = createDiffClient();
    const setup = await renderPanel(client);

    await waitFor(setup, () => readFrame(setup).includes("unstaged.txt"));
    await focusDiff(setup);
    await runAction("nav.down");
    await runAction("diff.stage");

    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.renderer.root.findDescendantById("diff-busy")).toBeDefined();

    await act(async () => {
      await setup.dispose();
    });
  });
});
