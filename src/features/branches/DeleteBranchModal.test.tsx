import { beforeEach, describe, expect, it } from "bun:test";
import { MouseEvent, type ScrollBoxRenderable, type SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { resetActionRegistry, resolveActionHandler } from "@/app/hooks/useAction";
import { buildListLocalBranchesArgs } from "@/domain/git/git.branches";
import { buildListRemoteBranchesArgs } from "@/domain/git/git.remote-branches";
import type { BranchRecord, GitClient, GitInvocationResult } from "@/domain/git/git.types";
import { DeleteBranchModal } from "@/features/branches/DeleteBranchModal";
import {
  DELETE_BRANCH_HAS_MORE_NOTICE,
  DELETE_BRANCH_RISK_LIST_ID,
  DELETE_BRANCH_SCROLL_HINT,
} from "@/features/branches/DeleteBranchModal.constants";
import { AppTestProviders } from "@/test/app.harness";
import { createFakeGitClient, fakeGitResult } from "@/test/git.fake";
import { ICONS } from "@/theme/icons";
import { MODAL_FRAME_ID } from "@/ui/ModalFrame.constants";

const SCOPE_ID = "branches-delete-scope";
const FORCE_ID = "branches-delete-force";
const CONFIRM_ID = "branches-delete-confirm";
const LOCAL_BRANCHES_KEY = buildListLocalBranchesArgs().join(" ");
const REMOTE_BRANCHES_KEY = buildListRemoteBranchesArgs().join(" ");
const FIXTURE_DATE = "2026-01-02T03:04:05+00:00";
const LOCAL_BRANCHES_OUTPUT = [
  `main\0abc123\0*\0${FIXTURE_DATE}\0origin\0refs/heads/main\0`,
  `topic\0def456\0 \0${FIXTURE_DATE}\0origin\0refs/heads/topic\0`,
].join("\n");
const REMOTE_BRANCHES_OUTPUT = [
  `refs/remotes/origin/main\0abc123\0${FIXTURE_DATE}\0initial commit\0`,
  `refs/remotes/origin/topic\0def456\0${FIXTURE_DATE}\0topic commit\0`,
  "",
].join("\n");
const RISK_COMMITS = [
  "1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\0fix the login form",
  "2222222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\0add missing tests",
].join("\n");

let deleted: { readonly scope: string; readonly force: boolean } | undefined;
let closed = 0;

const REMOTE = { remote: "origin", branch: "topic" };

/**
 * Builds a capped at-risk read with one commit per index.
 *
 * @param count - Number of commits to produce.
 * @returns The NUL-separated log output.
 */
function buildRiskCommits(count: number): string {
  return Array.from(
    { length: count },
    (_, index) => `oid${index}aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\0commit subject ${index}`,
  ).join("\n");
}

function buildBranch(overrides: Partial<BranchRecord> = {}): BranchRecord {
  return {
    name: "topic",
    head: false,
    tipOid: "abc123",
    committerDate: "2026-01-02T03:04:05+00:00",
    upstream: "origin/topic",
    upstreamRemote: "origin",
    upstreamBranch: "topic",
    ahead: 0,
    behind: 0,
    worktreePath: null,
    upstreamStatus: "tracked",
    ...overrides,
  };
}

function buildClient(riskResult: GitInvocationResult | Promise<GitInvocationResult>): GitClient {
  const fake = createFakeGitClient();

  return {
    gitPath: fake.client.gitPath,
    invoke: async (options) => {
      const key = options.args.join(" ");

      if (options.args[0] === "log" && options.args.includes("--max-count=21")) {
        return await riskResult;
      }

      if (key === LOCAL_BRANCHES_KEY) {
        return fakeGitResult(LOCAL_BRANCHES_OUTPUT);
      }

      if (key === REMOTE_BRANCHES_KEY) {
        return fakeGitResult(REMOTE_BRANCHES_OUTPUT);
      }

      return fake.client.invoke(options);
    },
  };
}

function Harness(props: {
  readonly branch?: BranchRecord;
  readonly blockedReason?: string | null;
  readonly remote?: { readonly remote: string; readonly branch: string } | null;
  readonly remoteReason?: string | null;
}): ReactNode {
  return (
    <DeleteBranchModal
      branch={props.branch ?? buildBranch()}
      blockedReason={props.blockedReason ?? null}
      remote={props.remote === undefined ? REMOTE : props.remote}
      remoteReason={props.remoteReason ?? null}
      onClose={() => {
        closed += 1;
      }}
      onDelete={(input) => {
        deleted = input;
      }}
    />
  );
}

async function renderModal(
  props: Parameters<typeof Harness>[0] = {},
  riskResult: GitInvocationResult | Promise<GitInvocationResult> = fakeGitResult(""),
  size: { readonly width: number; readonly height: number } = { width: 100, height: 32 },
): Promise<Awaited<ReturnType<typeof testRender>>> {
  const setup = await testRender(
    <AppTestProviders gitClient={buildClient(riskResult)}>
      <Harness {...props} />
    </AppTestProviders>,
    size,
  );

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

/**
 * Renders frames until the predicate holds or the deadline passes.
 *
 * @param setup - Renderer setup.
 * @param predicate - Condition the test waits for.
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
}

function click(setup: Awaited<ReturnType<typeof testRender>>, id: string): void {
  const box = setup.renderer.root.findDescendantById(id);

  if (box === undefined) {
    throw new Error(`${id} is missing`);
  }

  box.processMouseEvent(
    new MouseEvent(box, {
      type: "down",
      button: 0,
      x: 0,
      y: 0,
      modifiers: { shift: false, alt: false, ctrl: false },
    }),
  );
}

async function runOverlayAction(actionId: string): Promise<void> {
  await act(async () => {
    resolveActionHandler(actionId, "overlay")?.();
  });
}

async function selectRemoteScope(setup: Awaited<ReturnType<typeof testRender>>): Promise<void> {
  const select = setup.renderer.root.findDescendantById(SCOPE_ID) as SelectRenderable | undefined;

  if (select === undefined) {
    throw new Error("scope select is missing");
  }

  await act(async () => {
    select.moveDown();
  });
  await act(async () => {
    select.selectCurrent();
    await setup.renderOnce();
  });
}

/**
 * Splits a captured frame into its rows.
 *
 * @param frame - Captured character frame.
 * @returns The rows without the trailing line break.
 */
function frameLines(frame: string): string[] {
  return frame.replace(/\n$/, "").split("\n");
}

/**
 * Finds the single frame row that contains a marker and reads the modal border columns.
 *
 * @param lines - Frame rows.
 * @param needle - Text the row must contain.
 * @returns The row index, its text, and the modal border columns taken from the title row.
 */
function findRow(
  lines: readonly string[],
  needle: string,
): {
  readonly index: number;
  readonly line: string;
  readonly left: number;
  readonly right: number;
} {
  const index = lines.findIndex((line) => line.includes(needle));

  if (index < 0) {
    throw new Error(`no frame row contains ${needle}`);
  }

  const titleIndex = lines.findIndex((line) => line.includes("Delete branch"));

  if (titleIndex < 0) {
    throw new Error("the modal title row is missing");
  }

  const titleLine = lines[titleIndex] ?? "";
  const left = titleLine.search(/\S/);
  const right = titleLine.trimEnd().length - 1;

  if (left < 0 || right <= left) {
    throw new Error("the modal border columns are missing");
  }

  return { index, line: lines[index] ?? "", left, right };
}

/**
 * Asserts that one frame row is painted inside the modal border and nothing escapes outside it.
 *
 * @param lines - Frame rows.
 * @param row - Row read by `findRow`.
 */
function expectInsideFrame(lines: readonly string[], row: ReturnType<typeof findRow>): void {
  const referenceLine = lines.find((line) => line.includes("Branch:")) ?? "";

  expect(row.line[row.left]).toBe(referenceLine[row.left]);
  expect(row.line[row.right]).toBe(referenceLine[row.right]);
  expect(row.line.slice(0, row.left).trim()).toBe("");
  expect(row.line.slice(row.right + 1).trim()).toBe("");
}

beforeEach(() => {
  resetActionRegistry();
  deleted = undefined;
  closed = 0;
});

describe("DeleteBranchModal", () => {
  it("starts with the scope select focused and names both scopes", async () => {
    const setup = await renderModal();
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Branch: topic");
    expect(frame).toContain("Delete local branch only");
    expect(frame).toContain("Delete local and remote branch");
    expect(frame).toContain("Remote branch: origin/topic");
    expect(frame).not.toContain("Acknowledge to force");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe(SCOPE_ID);

    await runOverlayAction("nav.activate");

    expect(closed).toBe(0);
    expect(deleted).toBeUndefined();

    await runOverlayAction("nav.right");
    await runOverlayAction("nav.left");
    await runOverlayAction("nav.activate");

    expect(closed).toBe(1);
    expect(deleted).toBeUndefined();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps native focus on the scope select while native navigation changes the scope", async () => {
    const setup = await renderModal();
    const select = setup.renderer.root.findDescendantById(SCOPE_ID) as SelectRenderable | undefined;

    if (select === undefined) {
      throw new Error("scope select is missing");
    }

    await act(async () => {
      select.focus();
    });
    await act(async () => {
      select.moveDown();
      await setup.renderOnce();
    });

    expect(setup.renderer.currentFocusedRenderable?.id).toBe(SCOPE_ID);
    expect(select.getSelectedIndex()).toBe(1);

    await act(async () => {
      select.selectCurrent();
      await setup.renderOnce();
    });

    expect(setup.renderer.currentFocusedRenderable?.id).toBe(MODAL_FRAME_ID);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("submits the local scope with force false when the branch is already merged", async () => {
    const setup = await renderModal();

    await waitFor(setup, () => setup.captureCharFrame().includes("The branch is merged"));

    expect(setup.renderer.root.findDescendantById(FORCE_ID)).toBeUndefined();

    await runOverlayAction("nav.right");
    await runOverlayAction("nav.activate");

    expect(deleted).toEqual({ scope: "local", force: false });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("advances from the scope to Delete and submits on the next Enter", async () => {
    const setup = await renderModal();
    const select = setup.renderer.root.findDescendantById(SCOPE_ID) as SelectRenderable | undefined;

    await waitFor(setup, () => setup.captureCharFrame().includes("The branch is merged"));

    await act(async () => {
      select?.focus();
      select?.selectCurrent();
      await setup.renderOnce();
    });

    await runOverlayAction("nav.activate");

    expect(deleted).toEqual({ scope: "local", force: false });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("requires the acknowledgement before a local-remote force delete runs", async () => {
    const setup = await renderModal({}, fakeGitResult(RISK_COMMITS));

    await waitFor(setup, () => setup.captureCharFrame().includes("fix the login form"));

    const frame = setup.captureCharFrame();

    expect(frame).toContain("1111111 fix the login form");
    expect(frame).toContain("2222222 add missing tests");
    expect(frame).toContain(ICONS.checkboxOff);

    await selectRemoteScope(setup);
    await runOverlayAction("nav.right");
    await runOverlayAction("nav.activate");

    expect(deleted).toBeUndefined();

    await act(async () => {
      click(setup, FORCE_ID);
    });
    await act(async () => {
      click(setup, CONFIRM_ID);
    });

    expect(deleted).toEqual({ scope: "local-remote", force: true });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("hides the force acknowledgement when the read reports a merged branch", async () => {
    const setup = await renderModal({}, fakeGitResult(""));

    await waitFor(setup, () => setup.captureCharFrame().includes("The branch is merged"));

    expect(setup.captureCharFrame()).not.toContain("Force delete");
    expect(setup.renderer.root.findDescendantById(FORCE_ID)).toBeUndefined();

    await selectRemoteScope(setup);
    await runOverlayAction("nav.right");
    await runOverlayAction("nav.activate");

    expect(deleted).toEqual({ scope: "local-remote", force: false });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows the loading state and blocks confirm while commits at risk are read", async () => {
    const pending = new Promise<GitInvocationResult>(() => {});
    const setup = await renderModal({}, pending);

    await waitFor(setup, () => setup.captureCharFrame().includes("Reading commits at risk"));

    expect(setup.captureCharFrame()).toContain("Reading commits at risk");

    await runOverlayAction("nav.right");
    await runOverlayAction("nav.activate");

    expect(deleted).toBeUndefined();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the force path available when the at-risk read fails", async () => {
    const setup = await renderModal(
      {},
      fakeGitResult("", false, "fatal: bad revision refs/remotes/origin/topic"),
    );

    await waitFor(setup, () => setup.captureCharFrame().includes("Could not read commits at risk"));

    expect(setup.captureCharFrame()).toContain("Could not read commits at risk");
    expect(setup.renderer.root.findDescendantById(FORCE_ID)).toBeDefined();

    await runOverlayAction("nav.right");
    await runOverlayAction("nav.activate");

    expect(deleted).toBeUndefined();

    await act(async () => {
      click(setup, FORCE_ID);
    });
    await act(async () => {
      click(setup, CONFIRM_ID);
    });

    expect(deleted).toEqual({ scope: "local", force: true });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the force control and footer visible with a capped list in a short terminal", async () => {
    const setup = await renderModal({}, fakeGitResult(buildRiskCommits(21)), {
      width: 80,
      height: 24,
    });

    await waitFor(setup, () => setup.captureCharFrame().includes("commit subject 0"));

    const frame = setup.captureCharFrame();

    expect(frame).toContain("commit subject 0");
    expect(frame).toContain(DELETE_BRANCH_HAS_MORE_NOTICE);
    expect(frame).toContain("Force delete");
    expect(frame).toContain("Cancel");
    expect(frame.replace(/\n$/, "").split("\n")).toHaveLength(24);
    expect(setup.renderer.root.findDescendantById(DELETE_BRANCH_RISK_LIST_ID)).toBeDefined();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the force row and footer inside the frame for a long branch name with a capped list", async () => {
    const longName = "feature/a-very-long-branch-name-that-exceeds-the-modal-content-width";
    const setup = await renderModal(
      {
        branch: buildBranch({ name: longName, upstream: `origin/${longName}`, behind: 3 }),
        remote: { remote: "origin", branch: longName },
      },
      fakeGitResult(buildRiskCommits(21)),
      { width: 80, height: 24 },
    );

    await waitFor(setup, () => setup.captureCharFrame().includes("commit subject 0"));
    await selectRemoteScope(setup);

    const lines = frameLines(setup.captureCharFrame());
    const branchRow = findRow(lines, "Branch:");
    const remoteRow = findRow(lines, "Remote branch:");
    const headingRow = findRow(lines, "Commits that only exist on ");
    const forceRow = findRow(lines, "Force delete");
    const acknowledgementRow = findRow(lines, "Acknowledge to force");
    const footerRow = findRow(lines, "Cancel");

    expect(lines).toHaveLength(24);
    expect(lines.filter((line) => line.includes("Branch:"))).toHaveLength(1);
    expect(branchRow.line).toContain(
      "Branch: feature/a-very-long-branch-name-that-exceeds-the-...",
    );
    expect(branchRow.line).toContain(ICONS.ellipsis);
    expect(branchRow.line).not.toContain(longName);
    expect(remoteRow.line).toContain("Remote branch: origin/");
    expect(remoteRow.line).toContain(ICONS.ellipsis);
    expect(remoteRow.line).not.toContain(longName);
    expect(headingRow.line).toContain("Commits that only exist on ");
    expect(headingRow.line).toContain(ICONS.ellipsis);
    expect(headingRow.line).not.toContain(longName);
    expect(forceRow.line).toContain("Force delete (branch -D) for an unmerged branch");
    expect(forceRow.line).not.toContain("Acknowledge to force");
    expect(acknowledgementRow.line).not.toContain("Force delete");
    expect(footerRow.line).toContain("Delete local and remote branch");
    expectInsideFrame(lines, footerRow);
    expectInsideFrame(lines, forceRow);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the footer inside the modal border while confirm is unacknowledged", async () => {
    const setup = await renderModal({}, fakeGitResult(buildRiskCommits(2)), {
      width: 80,
      height: 24,
    });

    await waitFor(setup, () => setup.captureCharFrame().includes("commit subject 1"));

    const lines = frameLines(setup.captureCharFrame());
    const footerRow = findRow(lines, "Cancel");
    const acknowledgementRow = findRow(lines, "Acknowledge the force delete to continue");

    expect(acknowledgementRow.line).toContain("Acknowledge the force delete to continue");
    expect(acknowledgementRow.index).not.toBe(footerRow.index);
    expect(footerRow.line).toContain("Delete local branch");
    expect(footerRow.line).not.toContain("Acknowledge the force delete to continue");
    expectInsideFrame(lines, footerRow);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("scrolls the at-risk list by one viewport with PageDown", async () => {
    const commits = Array.from(
      { length: 20 },
      (_, index) => `oid${index}aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\0commit subject ${index}`,
    ).join("\n");
    const setup = await renderModal({}, fakeGitResult(commits), { width: 80, height: 24 });

    await waitFor(setup, () => setup.captureCharFrame().includes("commit subject 0"));
    await waitFor(setup, () => resolveActionHandler("nav.pageDown", "overlay") !== undefined);

    const before = setup.captureCharFrame();

    expect(before).toContain("commit subject 0");
    expect(before).not.toContain("commit subject 2");
    expect(before).toContain(DELETE_BRANCH_SCROLL_HINT);

    await runOverlayAction("nav.pageDown");
    await act(async () => {
      await setup.renderOnce();
    });

    const after = setup.captureCharFrame();
    const list = setup.renderer.root.findDescendantById(DELETE_BRANCH_RISK_LIST_ID) as
      | ScrollBoxRenderable
      | undefined;

    expect(after).toContain(`commit subject ${list?.height ?? 0}`);
    expect(after).not.toContain("commit subject 0");
    expect(list?.scrollTop ?? 0).toBeGreaterThan(0);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("truncates a long at-risk subject instead of clipping the control row", async () => {
    const longSubject = "fix ".repeat(40).trim();
    const setup = await renderModal(
      {},
      fakeGitResult(`1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\0${longSubject}`),
      { width: 80, height: 24 },
    );

    await waitFor(setup, () => setup.captureCharFrame().includes("Force delete"));

    const frame = setup.captureCharFrame();

    expect(frame).toContain(ICONS.ellipsis);
    expect(frame).not.toContain(longSubject);
    expect(frame).toContain("Force delete");
    expect(frame).toContain("Cancel");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("disables the confirm action for a branch that cannot be deleted", async () => {
    const setup = await renderModal({
      blockedReason: "Cannot delete the current branch",
      branch: buildBranch({ head: true }),
    });
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Cannot delete the current branch");

    await runOverlayAction("nav.right");
    await runOverlayAction("nav.activate");

    expect(deleted).toBeUndefined();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("disables the remote scope when nothing resolves and explains local-only deletion", async () => {
    const setup = await renderModal({ remote: null, remoteReason: "no matching remote branch" });

    expect(setup.captureCharFrame()).toContain("no matching remote branch");
    expect(setup.captureCharFrame()).toContain("only the local");

    await selectRemoteScope(setup);
    await runOverlayAction("nav.right");
    await runOverlayAction("nav.activate");

    expect(deleted).toBeUndefined();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("warns that the remote has commits missing locally when the branch is behind", async () => {
    const setup = await renderModal({ branch: buildBranch({ behind: 3 }) });

    await selectRemoteScope(setup);

    expect(setup.captureCharFrame()).toContain(
      `${ICONS.warning} the remote branch has 3 commit(s) not present locally`,
    );

    await act(async () => {
      await setup.dispose();
    });
  });
});
