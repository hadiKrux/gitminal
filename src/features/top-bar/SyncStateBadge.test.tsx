import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import type { SyncState } from "@/domain/repository/repository.types";
import { DEFAULT_THEME_NAME } from "@/domain/theme/theme.catppuccin";
import { resolveTheme } from "@/domain/theme/theme.resolve";
import { SyncStateBadge } from "@/features/top-bar/SyncStateBadge";
import { ShellTestProviders } from "@/test/shell.harness";

/** Default tokens used by the badge test. */
const TOKENS = resolveTheme(DEFAULT_THEME_NAME).tokens;

/** Expected marker and label for every sync state. */
const EXPECTED: Readonly<Record<SyncState, string>> = {
  "up-to-date": "v up to date",
  ahead: "^ ahead",
  behind: "v behind",
  diverged: "! diverged",
  "no-upstream": "- no upstream",
  "upstream-gone": "[?] upstream gone",
};

/**
 * Renders one sync badge.
 *
 * @param sync - Sync state.
 * @returns The renderer setup.
 */
async function renderBadge(sync: SyncState): Promise<Awaited<ReturnType<typeof testRender>>> {
  return testRender(
    <ShellTestProviders>
      <SyncStateBadge sync={sync} tokens={TOKENS} />
    </ShellTestProviders>,
    { width: 40, height: 3 },
  );
}

describe("SyncStateBadge", () => {
  it("renders a marker and text for all six sync states", async () => {
    for (const [sync, expected] of Object.entries(EXPECTED) as readonly [SyncState, string][]) {
      const setup = await renderBadge(sync);

      await act(async () => {
        await setup.renderOnce();
      });

      expect(setup.captureCharFrame(), sync).toContain(expected);

      await act(async () => {
        await setup.dispose();
      });
    }
  });
});
