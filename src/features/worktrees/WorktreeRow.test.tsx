import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import type { WorktreeRecord } from "@/domain/git/git.types";
import { WorktreeRow } from "@/features/worktrees/WorktreeRow";
import { ShellTestProviders } from "@/test/shell.harness";
import { ICONS } from "@/theme/icons";

/** Path long enough that the row must shorten it at the test width. */
const LONG_PATH = "/Users/example/projects/gitminal/worktrees/feature-branch";

/**
 * Builds one worktree record with the reported flags overridden per test.
 *
 * @param overrides - Record fields to replace.
 * @returns The worktree record.
 */
function buildWorktree(overrides: Partial<WorktreeRecord> = {}): WorktreeRecord {
  return {
    path: LONG_PATH,
    headOid: "abcdef1234567890",
    branch: "feature-branch",
    detached: false,
    bare: false,
    locked: false,
    lockReason: null,
    prunable: false,
    pruneReason: null,
    current: false,
    dirty: false,
    ...overrides,
  };
}

/**
 * Renders one worktree row at a sidebar-sized terminal width.
 *
 * @param row - Worktree record to render.
 * @param selected - Whether the row is the cursor row.
 * @returns The renderer setup.
 */
async function renderRow(row: WorktreeRecord, selected: boolean) {
  const content: ReactNode = (
    <ShellTestProviders>
      <box flexDirection="column" width={30} height={6}>
        <WorktreeRow
          row={row}
          selected={selected}
          focused={false}
          onPress={() => {
            return;
          }}
        />
      </box>
    </ShellTestProviders>
  );
  const setup = await testRender(content, { width: 60, height: 10 });

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

describe("WorktreeRow", () => {
  it("shows the current, locked, prunable, and dirty markers with their detail reasons", async () => {
    const setup = await renderRow(
      buildWorktree({
        current: true,
        locked: true,
        lockReason: "held by another process",
        prunable: true,
        pruneReason: "directory is gone",
        dirty: true,
      }),
      true,
    );
    const frame = setup.captureCharFrame();

    expect(frame).toContain("feature-branch");
    expect(frame).toContain(ICONS.currentBranch);
    expect(frame).toContain(ICONS.locked);
    expect(frame).toContain(ICONS.prunable);
    expect(frame).toContain("current worktree");
    expect(frame).toContain("held by another process");
    expect(frame).toContain("prunable: directory is gone");
    expect(frame).toContain("dirty");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows the detached marker with the seven-character head hash", async () => {
    const setup = await renderRow(
      buildWorktree({ branch: null, detached: true, headOid: "1234567890abcdef" }),
      false,
    );
    const frame = setup.captureCharFrame();

    expect(frame).toContain(`${ICONS.detached} 1234567`);
    expect(frame).not.toContain("dirty");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shortens a long path and keeps its tail", async () => {
    const setup = await renderRow(buildWorktree(), false);
    const frame = setup.captureCharFrame();

    expect(frame).not.toContain(LONG_PATH);
    expect(frame).toContain(ICONS.ellipsis);
    expect(frame).toContain("feature-branch");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("omits the dirty marker when the snapshot reports no dirty read", async () => {
    const setup = await renderRow(buildWorktree({ dirty: false }), true);
    const frame = setup.captureCharFrame();

    expect(frame).not.toContain("dirty");

    await act(async () => {
      await setup.dispose();
    });
  });
});
