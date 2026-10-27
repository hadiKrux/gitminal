import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import type { BranchRecord } from "@/domain/git/git.types";
import { BranchRow } from "@/features/branches/BranchRow";
import { truncateText } from "@/lib/text";
import { ShellTestProviders } from "@/test/shell.harness";
import { ICONS } from "@/theme/icons";

const COMMITTER_DATE = "2026-01-02T03:04:05+00:00";

function buildBranch(overrides: Partial<BranchRecord> = {}): BranchRecord {
  return {
    name: "main",
    head: false,
    tipOid: "abc123",
    committerDate: COMMITTER_DATE,
    upstream: null,
    upstreamRemote: null,
    upstreamBranch: null,
    ahead: 0,
    behind: 0,
    worktreePath: null,
    upstreamStatus: "none",
    ...overrides,
  };
}

async function renderRow(
  branch: BranchRecord,
  props?: {
    readonly selected?: boolean;
    readonly deleteReason?: string | null;
  },
): Promise<Awaited<ReturnType<typeof testRender>>> {
  const setup = await testRender(
    <ShellTestProviders>
      <box flexDirection="column" width={60} height={8}>
        <BranchRow
          branch={branch}
          selected={props?.selected ?? false}
          focused={false}
          deleteReason={props?.deleteReason ?? null}
        />
      </box>
    </ShellTestProviders>,
    { width: 60, height: 8 },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

describe("BranchRow", () => {
  it("renders the current marker, the name, and the counts without a focus marker", async () => {
    const setup = await renderRow(
      buildBranch({
        head: true,
        upstream: "origin/main",
        upstreamRemote: "origin",
        upstreamBranch: "main",
        upstreamStatus: "tracked",
        ahead: 2,
        behind: 1,
      }),
      { selected: true },
    );
    const frame = setup.captureCharFrame();

    expect(frame).toContain(`${ICONS.currentBranch} main`);
    expect(frame).not.toContain(ICONS.selected);
    expect(frame).not.toContain(ICONS.worktree);
    expect(frame).toContain(`${ICONS.push}2`);
    expect(frame).toContain(`${ICONS.pull}1`);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("renders the worktree marker and the checked out path", async () => {
    const setup = await renderRow(buildBranch({ name: "feature", worktreePath: "/repo-feature" }), {
      selected: true,
    });
    const frame = setup.captureCharFrame();

    expect(frame).toContain(`${ICONS.worktree} feature`);
    expect(frame).not.toContain(ICONS.selected);
    expect(frame).not.toContain(ICONS.currentBranch);
    expect(frame).toContain(truncateText("checked out in /repo-feature", 24, ICONS.ellipsis));

    await act(async () => {
      await setup.dispose();
    });
  });

  it("hides the counts and shows the exact not-found text", async () => {
    const setup = await renderRow(
      buildBranch({
        upstream: "origin/main",
        upstreamRemote: "origin",
        upstreamBranch: "main",
        upstreamStatus: "notFound",
        ahead: 2,
        behind: 1,
      }),
      { selected: true },
    );
    const frame = setup.captureCharFrame();

    expect(frame).toContain(`${ICONS.missingUpstream} upstream not found`);
    expect(frame).not.toContain(`${ICONS.push}2`);
    expect(frame).not.toContain(`${ICONS.pull}1`);
    expect(frame).toContain("origin/main is not present locally");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows the exact deleted text for a remote branch removed from the remote", async () => {
    const setup = await renderRow(
      buildBranch({
        upstream: "origin/topic",
        upstreamRemote: "origin",
        upstreamBranch: "topic",
        upstreamStatus: "deleted",
        ahead: 1,
        behind: 3,
      }),
      { selected: true },
    );
    const frame = setup.captureCharFrame();

    expect(frame).toContain(`${ICONS.missingUpstream} remote branch deleted`);
    expect(frame).not.toContain(`${ICONS.push}1`);
    expect(frame).not.toContain(`${ICONS.pull}3`);
    expect(frame).toContain("origin/topic was deleted from the remote");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows no upstream and the unknown explanation without a deleted claim", async () => {
    const none = await renderRow(buildBranch({ name: "feature" }));

    expect(none.captureCharFrame()).toContain("no upstream");

    await act(async () => {
      await none.dispose();
    });

    const unknown = await renderRow(
      buildBranch({
        name: "feature",
        upstream: "origin/feature",
        upstreamRemote: "origin",
        upstreamBranch: "feature",
        upstreamStatus: "unknown",
        ahead: 1,
      }),
      { selected: true },
    );
    const frame = unknown.captureCharFrame();

    expect(frame).toContain(`${ICONS.missingUpstream} upstream unknown`);
    expect(frame).not.toContain("remote branch deleted");
    expect(frame).toContain("the remote check for origin/feature did not complete");
    expect(frame).toContain(`${ICONS.push}1`);

    await act(async () => {
      await unknown.dispose();
    });
  });

  it("truncates a long name and keeps the state text visible", async () => {
    const longName = "feature/a-very-long-branch-name-that-does-not-fit";
    const setup = await renderRow(buildBranch({ name: longName }));
    const frame = setup.captureCharFrame();

    expect(frame).toContain(ICONS.ellipsis);
    expect(frame).not.toContain(longName);
    expect(frame).toContain("no upstream");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("renders the delete reason only on the selected row", async () => {
    const branch = buildBranch({ name: "feature" });
    const reason = "checked out in another worktree";
    const unselected = await renderRow(branch, { deleteReason: reason });

    expect(unselected.captureCharFrame()).not.toContain(reason);

    await act(async () => {
      await unselected.dispose();
    });

    const selected = await renderRow(branch, { selected: true, deleteReason: reason });

    expect(selected.captureCharFrame()).toContain(reason);

    await act(async () => {
      await selected.dispose();
    });
  });
});
