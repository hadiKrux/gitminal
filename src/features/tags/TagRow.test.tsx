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
  it("renders the documented scope indicator for every logical state", async () => {
    const upArrow = String.fromCodePoint(0x2191);
    const cases: readonly (readonly [TagScopeState, string])[] = [
      ["local", "[L ]"],
      ["remote", "[ R]"],
      ["both", "[LR]"],
      ["unpushed", `[L${upArrow}]`],
      ["local-only", "[L ]"],
      ["unknown", "[L?]"],
    ];

    for (const [state, expected] of cases) {
      const { setup, frame } = await renderRow(tagRow({ state }), 80);

      expect(frame, state).toContain(expected);
      expect(frame, state).toContain("v1.0.0");

      if (state === "unknown") {
        expect(frame).not.toContain(upArrow);
      }

      await act(async () => {
        await setup.dispose();
      });
    }
  });

  it("keeps the row width constant across states", async () => {
    const states: readonly TagScopeState[] = ["local", "remote", "both", "unpushed", "unknown"];

    for (const state of states) {
      const { setup, frame } = await renderRow(tagRow({ state, subject: "" }), 80);
      const row = frame.split("\n").find((line) => line.includes("v1.0.0")) ?? "";

      expect(row.trim(), state).toHaveLength("v1.0.0 [LR]".length);

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
    expect(frame).toContain("[L ]");
    expect(frame).toContain(ICONS.ellipsis);
    expect(frame).not.toContain(subject);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("drops the subject on a narrow terminal while keeping the tag identity", async () => {
    const { setup, frame } = await renderRow(
      tagRow({ name: "v1", subject: "not enough room" }),
      14,
    );

    expect(frame).toContain("v1");
    expect(frame).toContain("[L ]");
    expect(frame).not.toContain("not enough room");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("suppresses the selection marker so the selected fill identifies the cursor row", async () => {
    const { setup, frame } = await renderRow(tagRow(), 80, true);

    expect(frame).not.toContain(ICONS.selected);
    expect(frame).not.toContain(ICONS.focus);
    expect(frame).toContain(" v1.0.0 [L ]");

    await act(async () => {
      await setup.dispose();
    });
  });
});
