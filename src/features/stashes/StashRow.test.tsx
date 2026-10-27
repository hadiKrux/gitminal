import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import type { StashRecord } from "@/domain/git/git.types";
import { StashRow } from "@/features/stashes/StashRow";
import { ShellTestProviders } from "@/test/shell.harness";
import { ICONS } from "@/theme/icons";

/**
 * Builds one stash record for a row test.
 *
 * @param overrides - Record fields to override.
 * @returns The stash record.
 */
function stash(overrides: Partial<StashRecord> = {}): StashRecord {
  return {
    index: "stash@{0}",
    objectName: "aaa111",
    subject: "work in progress",
    sourceBranch: "feature",
    committedAt: Math.floor(Date.now() / 1000) - 7_300,
    ...overrides,
  };
}

/**
 * Renders one row inside a shell provider.
 *
 * @param record - Stash record to render.
 * @param options - Selected and focused flags plus terminal width.
 * @returns The renderer setup.
 */
async function renderRow(
  record: StashRecord,
  options: {
    readonly selected?: boolean;
    readonly focused?: boolean;
    readonly width?: number;
  } = {},
): Promise<Awaited<ReturnType<typeof testRender>>> {
  const setup = await testRender(
    <ShellTestProviders>
      <box flexDirection="column" width={options.width ?? 60} height={4}>
        <StashRow
          stash={record}
          selected={options.selected ?? true}
          focused={options.focused ?? true}
        />
      </box>
    </ShellTestProviders>,
    { width: options.width ?? 60, height: 6 },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

describe("StashRow", () => {
  it("renders the index, source branch, relative age, and message without a selection marker", async () => {
    const setup = await renderRow(stash());
    const frame = setup.captureCharFrame();

    expect(frame).not.toContain(ICONS.selected);
    expect(frame).not.toContain(ICONS.focus);
    expect(frame).toContain("stash@{0}");
    expect(frame).toContain("feature");
    expect(frame).toContain("2h ago");
    expect(frame).toContain("work in progress");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the index and age when a long message truncates", async () => {
    const subject = "x".repeat(120);
    const setup = await renderRow(stash({ subject }), { width: 40 });
    const frame = setup.captureCharFrame();

    expect(frame).toContain("stash@{0}");
    expect(frame).toContain("2h ago");
    expect(frame).toContain("...");
    expect(frame).not.toContain(subject);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keys the row by the immutable object name, not the display index", async () => {
    const setup = await renderRow(stash({ index: "stash@{3}", objectName: "abcdef" }));

    expect(setup.renderer.root.findDescendantById("stash-row:abcdef")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("stash-row:stash@{3}")).toBeUndefined();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("omits the source branch when git did not record one", async () => {
    const setup = await renderRow(stash({ sourceBranch: null }));
    const frame = setup.captureCharFrame();

    expect(frame).toContain("stash@{0}");
    expect(frame).not.toContain("feature");

    await act(async () => {
      await setup.dispose();
    });
  });
});
