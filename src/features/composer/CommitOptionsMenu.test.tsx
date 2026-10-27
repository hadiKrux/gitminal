import { beforeEach, describe, expect, it } from "bun:test";
import type { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { resetActionRegistry, resolveActionHandler } from "@/app/hooks/useAction";
import type { ActionId } from "@/domain/keymap/keymap.defaults";
import { ACTION_BY_ID } from "@/domain/keymap/keymap.defaults";
import { CommitOptionsMenu } from "@/features/composer/CommitOptionsMenu";
import { COMPOSER_MENU_SELECT_ID } from "@/features/composer/composer.constants";
import { AppTestProviders } from "@/test/app.harness";
import { createFakeGitClient } from "@/test/git.fake";

/** Variant rows in the documented menu order. */
const VARIANTS = [
  {
    commandId: "commit.submit",
    label: "Commit",
    description: "Commit the staged files",
    available: true,
    reason: null,
  },
  {
    commandId: "commit.submitNoVerify",
    label: "Commit --no-verify",
    description: "Commit the staged files without running hooks",
    available: true,
    reason: null,
  },
  {
    commandId: "commit.amend",
    label: "Commit --amend",
    description: "Replace the previous commit with the staged files",
    available: false,
    reason: "no previous commit",
  },
  {
    commandId: "commit.amendNoVerify",
    label: "Amend --no-verify",
    description: "Replace the previous commit without running hooks",
    available: false,
    reason: "no previous commit",
  },
] as const;

/** Recorded callbacks. */
let highlighted: string[] = [];
let ran: string[] = [];
let cancelled = 0;
let dismissed = 0;

/**
 * Renders the menu with the full provider stack.
 *
 * @param variants - Variant rows to show.
 * @returns The renderer setup.
 */
async function renderMenu(
  variants: readonly (typeof VARIANTS)[number][] = [...VARIANTS],
): Promise<Awaited<ReturnType<typeof testRender>>> {
  highlighted = [];
  ran = [];
  cancelled = 0;
  dismissed = 0;

  const setup = await testRender(
    <AppTestProviders gitClient={createFakeGitClient().client}>
      <CommitOptionsMenu
        variants={variants}
        onHighlight={(commandId) => {
          highlighted.push(commandId);
        }}
        onRun={(commandId) => {
          ran.push(commandId);
        }}
        onCancel={() => {
          cancelled += 1;
        }}
        onDismiss={() => {
          dismissed += 1;
        }}
      />
    </AppTestProviders>,
    { width: 100, height: 30 },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

/**
 * Reads the native select.
 *
 * @param setup - Renderer setup.
 * @returns The select renderable, or undefined when it is missing.
 */
function readSelect(setup: Awaited<ReturnType<typeof testRender>>): SelectRenderable | undefined {
  return setup.renderer.root.findDescendantById(COMPOSER_MENU_SELECT_ID) as
    | SelectRenderable
    | undefined;
}

beforeEach(() => {
  resetActionRegistry();
});

describe("CommitOptionsMenu", () => {
  it("renders the four variants in product order", async () => {
    const setup = await renderMenu();
    const frame = setup.captureCharFrame();
    const positions = VARIANTS.map((variant) => frame.indexOf(variant.label));

    for (const [index, position] of positions.entries()) {
      expect(position, VARIANTS[index]?.label).toBeGreaterThanOrEqual(0);
    }

    for (let index = 1; index < positions.length; index += 1) {
      expect(positions[index] ?? -1).toBeGreaterThan(positions[index - 1] ?? -1);
    }

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows the highlighted variant's disabled reason and reports the highlight", async () => {
    const setup = await renderMenu();
    const select = readSelect(setup);

    await act(async () => {
      select?.setSelectedIndex(2);
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).toContain("no previous commit");
    expect(highlighted.at(-1)).toBe("commit.amend");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("does not run a highlighted unavailable variant", async () => {
    const setup = await renderMenu();
    const select = readSelect(setup);

    await act(async () => {
      select?.setSelectedIndex(3);
      select?.selectCurrent();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(ran).toEqual([]);
    expect(setup.captureCharFrame()).toContain("no previous commit");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("runs an available highlighted variant through its own command id", async () => {
    const setup = await renderMenu();
    const select = readSelect(setup);

    await act(async () => {
      select?.setSelectedIndex(1);
      select?.selectCurrent();
    });

    expect(ran).toEqual(["commit.submitNoVerify"]);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("focuses the variant list first so Enter runs the highlighted variant", async () => {
    const setup = await renderMenu();
    const select = readSelect(setup);

    expect(setup.renderer.currentFocusedRenderable?.id).toBe(COMPOSER_MENU_SELECT_ID);
    expect(ran).toEqual([]);

    await act(async () => {
      select?.selectCurrent();
    });

    expect(ran).toEqual(["commit.submit"]);
    expect(cancelled).toBe(0);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("reaches Run and Cancel from the focused list with Left and Right", async () => {
    const setup = await renderMenu();

    await act(async () => {
      resolveActionHandler("nav.right", "overlay")?.();
    });
    await act(async () => {
      resolveActionHandler("nav.activate", "overlay")?.();
    });

    expect(cancelled).toBe(1);
    expect(ran).toEqual([]);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("restores the pre-menu draft through the dismiss cleanup on any other close", async () => {
    const setup = await renderMenu();

    await act(async () => {
      await setup.dispose();
    });

    expect(dismissed).toBe(1);
    expect(cancelled).toBe(0);
  });

  it("leaves the three menu-only variants without a default key", async () => {
    expect(ACTION_BY_ID["commit.submit"].defaults).toEqual(["ctrl+s", "mod+s"]);

    const menuOnly: readonly ActionId[] = [
      "commit.submitNoVerify",
      "commit.amend",
      "commit.amendNoVerify",
    ];

    for (const actionId of menuOnly) {
      expect(ACTION_BY_ID[actionId].defaults).toEqual([]);
    }
  });
});
