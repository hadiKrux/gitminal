import { beforeEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { resetActionRegistry } from "@/app/hooks/useAction";
import type { TagRowRecord, TagScopeState } from "@/domain/git/git.types";
import { TagRow } from "@/features/tags/TagRow";
import { ShellTestProviders } from "@/test/shell.harness";
import { ICONS } from "@/theme/icons";

/**
 * Builds one merged tag row for a rendering test.
 *
 * @param overrides - Row fields to override.
 * @returns The merged row.
 */
function tagRow(overrides: Partial<TagRowRecord> = {}): TagRowRecord {
  return {
    name: "v1.0.0",
    objectType: "commit",
    targetOid: "abc123",
    subject: "initial commit",
    local: true,
    remotes: [],
    state: "local-only",
    ...overrides,
  };
}

/**
 * Renders one tag row at a known terminal width.
 *
 * @param row - Row to render.
 * @param width - Terminal width in cells.
 * @param selected - Whether the row is the cursor row.
 * @returns The renderer setup and its captured frame.
 */
async function renderRow(
  row: TagRowRecord,
  width: number = 80,
  selected: boolean = false,
): Promise<{ readonly setup: Awaited<ReturnType<typeof testRender>>; readonly frame: string }> {
  const setup = await testRender(
    <ShellTestProviders>
      <box flexDirection="column" width={width} height={4}>
        <TagRow row={row} selected={selected} focused={false} onPress={() => {}} />
      </box>
    </ShellTestProviders>,
    { width, height: 4 },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  return { setup, frame: setup.captureCharFrame() };
}

beforeEach(() => {
  resetActionRegistry();
});

describe("TagRow", () => {
  it("renders the documented scope text for every logical state", async () => {
    const cases: readonly (readonly [TagScopeState, string, string[]])[] = [
      ["local", ICONS.tagLocal, []],
      ["remote", ICONS.tagRemote, []],
      ["both", `${ICONS.tagLocal} ${ICONS.tagRemote}`, []],
      ["unpushed", ICONS.tagUnpushed, []],
      ["local-only", ICONS.tagLocalOnly, []],
      ["unknown", "remote unknown", []],
    ];

    for (const [state, expected, forbidden] of cases) {
      const { setup, frame } = await renderRow(tagRow({ state }), 80);

      expect(frame, state).toContain(expected);
      expect(frame, state).toContain("v1.0.0");

      for (const text of forbidden) {
        expect(frame, state).not.toContain(text);
      }

      if (state === "unknown") {
        expect(frame).not.toContain(ICONS.tagUnpushed);
      }

      await act(async () => {
        await setup.dispose();
      });
    }
  });

  it("shows the peeled commit subject when the budget allows it", async () => {
    const { setup, frame } = await renderRow(tagRow({ subject: "fix the release pipeline" }), 80);

    expect(frame).toContain("fix the release pipeline");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("truncates a long subject before it can displace the tag name or scope", async () => {
    const subject = "a".repeat(60);
    const { setup, frame } = await renderRow(tagRow({ subject }), 40);

    expect(frame).toContain("v1.0.0");
    expect(frame).toContain(ICONS.tagLocalOnly);
    expect(frame).toContain(ICONS.ellipsis);
    expect(frame).not.toContain(subject);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("drops the subject on a narrow terminal while keeping the tag identity", async () => {
    const { setup, frame } = await renderRow(
      tagRow({ name: "v1", subject: "not enough room" }),
      20,
    );

    expect(frame).toContain("v1");
    expect(frame).toContain(ICONS.tagLocalOnly);
    expect(frame).not.toContain("not enough room");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("marks the cursor row with the selection marker", async () => {
    const { setup, frame } = await renderRow(tagRow(), 80, true);

    expect(frame).toContain(`${ICONS.selected}v1.0.0`);

    await act(async () => {
      await setup.dispose();
    });
  });
});
