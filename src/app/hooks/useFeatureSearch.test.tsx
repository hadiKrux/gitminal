import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { type InputRenderable, type Renderable, ScrollBoxRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { resetInputModes } from "@/app/hooks/inputMode.registry";
import { resetActionRegistry, resolveActionHandler } from "@/app/hooks/useAction";
import { resetActionAvailability } from "@/app/hooks/useActionAvailability";
import { useFocusState } from "@/app/hooks/useFocusState";
import { useHotkeys } from "@/app/hooks/useHotkeys";
import { useOverlay } from "@/app/hooks/useOverlay";
import { useRepository } from "@/app/hooks/useRepository";
import { useShellActions } from "@/app/hooks/useShellActions";
import { buildListLocalBranchesArgs } from "@/domain/git/git.branches";
import { buildListRemoteBranchesArgs } from "@/domain/git/git.remote-branches";
import { buildListStashesArgs } from "@/domain/git/git.stashes";
import { buildListLocalTagsArgs } from "@/domain/git/git.tags";
import { buildListWorktreesArgs } from "@/domain/git/git.worktrees";
import { readFeatureSearchRows } from "@/features/list-search/featureSearch.rows";
import { RemotesPanel } from "@/features/remotes/RemotesPanel";
import type { SidebarRegionId } from "@/features/shell/focus.types";
import { SidebarPanelFrame } from "@/features/shell/SidebarPanelFrame";
import { StashesPanel } from "@/features/stashes/StashesPanel";
import { TagsPanel } from "@/features/tags/TagsPanel";
import { WorktreesPanel } from "@/features/worktrees/WorktreesPanel";
import { AppTestProviders, TestOverlayHost } from "@/test/app.harness";
import { createFakeGitClient, fakeGitResult } from "@/test/git.fake";
import { ICONS } from "@/theme/icons";

let focus: ReturnType<typeof useFocusState>;
let repository: ReturnType<typeof useRepository>;
let overlay: ReturnType<typeof useOverlay>;
const longName = `feature/${"very-long-name-segment/".repeat(6)}unique-tail`;
const regions = ["remotes", "tags", "stashes", "worktrees"] as const;

function Probe({ region }: { region: Exclude<SidebarRegionId, "branches"> }) {
  focus = useFocusState();
  repository = useRepository();
  overlay = useOverlay();
  useHotkeys();
  useShellActions();
  const content = {
    remotes: <RemotesPanel />,
    tags: <TagsPanel />,
    stashes: <StashesPanel />,
    worktrees: <WorktreesPanel />,
  }[region];
  return (
    <>
      <box width={32} height={10}>
        <SidebarPanelFrame
          panel={{ regionId: region, label: region, content }}
          contentWidth={30}
          flexGrow={1}
        />
      </box>
      <TestOverlayHost />
    </>
  );
}

async function flush(setup: Awaited<ReturnType<typeof testRender>>) {
  await act(async () => {
    await setup.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

async function renderSearch(
  region: (typeof regions)[number],
  options: {
    empty?: boolean;
    fail?: boolean;
    rowCount?: number;
    loading?: boolean;
    shortNames?: boolean;
    remoteCommitDates?: readonly string[];
    localBranchOutput?: string;
    width?: number;
    height?: number;
  } = {},
) {
  const fake = createFakeGitClient();
  const rowCount = options.rowCount ?? 35;
  const rows = Array.from(
    { length: rowCount },
    (_, index) =>
      `${String(index).padStart(rowCount > 99 ? 4 : 2, "0")}/${index === rowCount - 1 && !options.shortNames ? longName : "branch"}`,
  );
  const answers = {
    [buildListRemoteBranchesArgs().join(" ")]: rows
      .map(
        (name, index) =>
          `refs/remotes/origin/${name}\0abc123\0${options.remoteCommitDates?.[index] ?? "2026-01-02T03:04:05+00:00"}\0subject\0`,
      )
      .join("\n"),
    [buildListLocalTagsArgs().join(" ")]: rows
      .map((name) => `${name}\0commit\0\0abc123\0\0subject`)
      .join("\n"),
    [buildListStashesArgs().join(" ")]: rows
      .map(
        (name, index) => `stash@{${index}}\0oid-${index}\0WIP on ${name}: subject\0${"1700000000"}`,
      )
      .join("\n"),
    [buildListWorktreesArgs().join(" ")]: rows
      .map((name) => `worktree /repo/${name}\nHEAD abc123\nbranch refs/heads/${name}\n`)
      .join("\n"),
  };
  const calls: string[] = [];
  const pendingReads: (() => void)[] = [];
  let readsReleased = !options.loading;
  const client = {
    gitPath: "git",
    invoke: async (invocation: Parameters<typeof fake.client.invoke>[0]) => {
      const key = invocation.args.join(" ");
      calls.push(key);
      if (
        options.localBranchOutput !== undefined &&
        key === buildListLocalBranchesArgs().join(" ")
      ) {
        return fakeGitResult(options.localBranchOutput);
      }
      if (key in answers && !readsReleased) {
        return new Promise<ReturnType<typeof fakeGitResult>>((resolve) => {
          pendingReads.push(() =>
            resolve(fakeGitResult(answers[key as keyof typeof answers] ?? "")),
          );
        });
      }

      return key in answers
        ? fakeGitResult(
            options.empty ? "" : (answers[key as keyof typeof answers] ?? ""),
            !options.fail,
            options.fail ? "read unavailable" : "",
          )
        : fake.client.invoke(invocation);
    },
  };
  const setup = await testRender(
    <AppTestProviders gitClient={client}>
      <Probe region={region} />
    </AppTestProviders>,
    { width: options.width ?? 120, height: options.height ?? 40 },
  );
  for (let i = 0; i < 12 && !options.loading && repository?.snapshot == null; i++) {
    await flush(setup);
  }
  await act(async () => {
    focus.focusRegion(region);
  });
  await flush(setup);
  return {
    setup,
    calls,
    releaseReads: () => {
      readsReleased = true;
      for (const release of pendingReads) {
        release();
      }
    },
  };
}

function readRenderable(setup: Awaited<ReturnType<typeof testRender>>, id: string): Renderable {
  const row = setup.renderer.root.findDescendantById(id);
  if (row === undefined) {
    throw new Error(`Missing renderable ${id}`);
  }
  return row;
}

function findScrollBox(root: Renderable): ScrollBoxRenderable {
  if (root instanceof ScrollBoxRenderable) {
    return root;
  }
  for (const child of root.getChildren()) {
    try {
      return findScrollBox(child);
    } catch {
      /* Search the next subtree. */
    }
  }
  throw new Error("No scrollbox found");
}

function expectVisible(row: Renderable | undefined, scroll: ScrollBoxRenderable): void {
  expect(row).toBeDefined();
  if (row === undefined) {
    throw new Error("Missing visible row");
  }
  expect(row.height).toBeGreaterThan(0);
  expect(row.y).toBeGreaterThanOrEqual(scroll.viewport.y);
  expect(row.y + row.height).toBeLessThanOrEqual(scroll.viewport.y + scroll.viewport.height);
}

function sidebarRowId(region: (typeof regions)[number], id: string): string {
  return {
    remotes: `remote-row-origin-${id.slice("origin/".length)}`,
    tags: `tag-row:${id}`,
    stashes: `stash-row:${id}`,
    worktrees: `worktree-row:${id}`,
  }[region];
}

beforeEach(() => {
  resetActionRegistry();
  resetActionAvailability();
  resetInputModes();
});
afterEach(() => {
  resetActionRegistry();
  resetActionAvailability();
  resetInputModes();
});

describe("feature search modal", () => {
  it("shows exact local-tracker markers in sidebar/search without adding marker text to matching", async () => {
    const date = "2026-01-02T03:04:05+00:00";
    const localBranchOutput = [
      `inactive-alias\0abc123\0 \0${date}\0origin\0refs/heads/01/branch\0`,
      `second-alias\0abc123\0 \0${date}\0origin\0refs/heads/01/branch\0`,
      `long-alias\0abc123\0 \0${date}\0origin\0refs/heads/02/${longName}\0`,
      `00/branch\0abc123\0*\0${date}\0\0\0`,
    ].join("\n");
    const { setup } = await renderSearch("remotes", { rowCount: 3, localBranchOutput });
    try {
      const rows = readFeatureSearchRows(
        "remotes",
        repository.snapshot,
        repository.remoteTagChecks,
      );
      expect(rows.map((row) => row.id)).toEqual([
        "origin/00/branch",
        "origin/01/branch",
        `origin/02/${longName}`,
      ]);
      expect(rows.map((row) => row.marker)).toEqual([
        undefined,
        ICONS.remoteLocalTracker,
        ICONS.remoteLocalTracker,
      ]);
      expect(rows[1]?.name).toBe("origin/01/branch");
      const sidebar = setup.captureCharFrame();
      expect(sidebar).toContain(`${ICONS.remoteLocalTracker} 01/branch`);
      expect(sidebar).not.toContain(`${ICONS.remoteLocalTracker} 00/branch`);
      expect(sidebar.indexOf("00/branch")).toBeLessThan(sidebar.indexOf("01/branch"));
      await act(async () => {
        setup.mockInput.pressKey("/");
      });
      await flush(setup);
      const firstInput = readRenderable(setup, "feature-search-input") as InputRenderable;
      await act(async () => {
        firstInput.insertText(ICONS.remoteLocalTracker);
      });
      await flush(setup);
      expect(setup.captureCharFrame()).toContain("No matches");
      expect(setup.renderer.root.findDescendantById("feature-search-row-0")).toBeUndefined();
      await act(async () => {
        setup.mockInput.pressEscape();
      });
      await flush(setup);
      await act(async () => {
        setup.mockInput.pressKey("/");
      });
      await flush(setup);
      const input = readRenderable(setup, "feature-search-input") as InputRenderable;
      await act(async () => {
        input.insertText("UNIQUE-TAIL");
      });
      await flush(setup);
      const frame = setup.captureCharFrame();
      expect(frame).toContain(`${ICONS.remoteLocalTracker} origin/02/feature`);
      expect(frame).toContain("unique-tail");
      expect(frame).toContain("Selected item");
    } finally {
      await act(async () => {
        await setup.dispose();
      });
    }
  });

  it.each([...regions])(
    "%s reserves exactly the two shared spacer rows within an 80x24 terminal",
    async (region) => {
      const { setup } = await renderSearch(region, { width: 80, height: 24 });
      try {
        await act(async () => {
          setup.mockInput.pressKey("/");
        });
        await flush(setup);
        await flush(setup);
        const input = readRenderable(setup, "feature-search-input");
        const details = readRenderable(setup, "feature-search-details");
        const results = readRenderable(setup, "feature-search-results") as ScrollBoxRenderable;
        const hints = readRenderable(setup, "feature-search-hints");
        const modal = readRenderable(setup, "modal-frame");
        expect(details.y - (input.y + input.height)).toBe(1);
        expect(hints.y - (results.y + results.height)).toBe(1);
        expect(results.height).toBeGreaterThan(0);
        expect(modal.y).toBeGreaterThanOrEqual(0);
        expect(modal.y + modal.height).toBeLessThanOrEqual(24);
        expect(hints.y + hints.height).toBeLessThan(modal.y + modal.height);
        const inputY = input.y;
        const detailsY = details.y;
        const hintsY = hints.y;
        await act(async () => {
          results.scrollTop = 15;
        });
        await flush(setup);
        expect(input.y).toBe(inputY);
        expect(details.y).toBe(detailsY);
        expect(hints.y).toBe(hintsY);
        expect(results.scrollTop).toBeGreaterThan(0);
      } finally {
        await act(async () => {
          await setup.dispose();
        });
      }
    },
  );

  it("keeps remote sidebar and search ordering coherent by latest tip commit without changing matching", async () => {
    const { setup } = await renderSearch("remotes", {
      rowCount: 3,
      shortNames: true,
      remoteCommitDates: ["2026-10-20T08:00:00Z", "2026-10-22T08:00:00Z", "2026-10-21T08:00:00Z"],
    });
    try {
      const rows = readFeatureSearchRows(
        "remotes",
        repository.snapshot,
        repository.remoteTagChecks,
      );
      expect(rows.map((row) => row.id)).toEqual([
        "origin/01/branch",
        "origin/02/branch",
        "origin/00/branch",
      ]);
      const sidebar = setup.captureCharFrame();
      expect(sidebar.indexOf("01/branch")).toBeLessThan(sidebar.indexOf("02/branch"));
      expect(sidebar.indexOf("02/branch")).toBeLessThan(sidebar.indexOf("00/branch"));
      expect(sidebar).not.toContain("origin/");
      await act(async () => {
        setup.mockInput.pressKey("/");
      });
      await flush(setup);
      await flush(setup);
      const input = readRenderable(setup, "feature-search-input") as InputRenderable;
      await act(async () => {
        input.insertText("BRANCH");
      });
      await flush(setup);
      const results = readRenderable(setup, "feature-search-results") as ScrollBoxRenderable;
      const frame = setup
        .captureCharFrame()
        .split("\n")
        .slice(results.viewport.y, results.viewport.y + results.viewport.height)
        .join("\n");
      expect(frame.indexOf("origin/01/branch")).toBeGreaterThanOrEqual(0);
      expect(frame.indexOf("origin/01/branch")).toBeLessThan(frame.indexOf("origin/02/branch"));
      expect(frame.indexOf("origin/02/branch")).toBeLessThan(frame.indexOf("origin/00/branch"));
    } finally {
      await act(async () => {
        await setup.dispose();
      });
    }
  });

  it.each([...regions])(
    "%s explicitly reveals the same accepted sidebar cursor after repeated free scrolling",
    async (region) => {
      const { setup } = await renderSearch(region);
      try {
        const cursor = focus.getCursor(region);
        if (cursor === null) {
          throw new Error("Missing sidebar cursor");
        }
        const sidebar = findScrollBox(readRenderable(setup, `region-${region}`));
        const row = readRenderable(setup, sidebarRowId(region, cursor));
        for (let attempt = 0; attempt < 2; attempt++) {
          await act(async () => {
            sidebar.scrollTop = 25;
          });
          await flush(setup);
          await flush(setup);
          expect(sidebar.scrollTop).toBeGreaterThan(0);
          expect(row.y + row.height).toBeLessThanOrEqual(sidebar.viewport.y);
          await act(async () => {
            setup.mockInput.pressKey("/");
          });
          await flush(setup);
          await act(async () => {
            setup.mockInput.pressEnter();
          });
          await flush(setup);
          await flush(setup);
          expect(overlay.entry).toBeNull();
          expect(focus.getCursor(region)).toBe(cursor);
          expectVisible(row, sidebar);
        }
      } finally {
        await act(async () => {
          await setup.dispose();
        });
      }
    },
  );

  it.each([...regions])(
    "%s reveals a far selected result on modal mount before any search navigation",
    async (region) => {
      const { setup } = await renderSearch(region);
      try {
        await act(async () => {
          for (let i = 0; i < 30; i++) {
            resolveActionHandler("nav.down", region)?.();
          }
        });
        await flush(setup);
        const cursor = focus.getCursor(region);
        await act(async () => {
          setup.mockInput.pressKey("/");
        });
        await flush(setup);
        await flush(setup);
        const results = setup.renderer.root.findDescendantById(
          "feature-search-results",
        ) as ScrollBoxRenderable;
        expect(results.scrollTop).toBeGreaterThan(0);
        expectVisible(results.content.findDescendantById("feature-search-row-30"), results);
        expect(focus.getCursor(region)).toBe(cursor);
      } finally {
        await act(async () => {
          await setup.dispose();
        });
      }
    },
  );

  it.each([true, false])(
    "sizes short-list whitespace to its content with shortNames=%s",
    async (shortNames) => {
      const { setup } = await renderSearch("worktrees", { rowCount: 1, shortNames });
      try {
        await act(async () => {
          setup.mockInput.pressKey("/");
        });
        await flush(setup);
        await flush(setup);
        const details = readRenderable(setup, "feature-search-details");
        const results = setup.renderer.root.findDescendantById(
          "feature-search-results",
        ) as ScrollBoxRenderable;
        const modal = readRenderable(setup, "modal-frame");
        expect(results.height).toBe(1);
        expect(details.height).toBeLessThanOrEqual(6);
        if (shortNames) {
          expect(details.height).toBe(3);
        } else {
          expect(details.height).toBeGreaterThan(3);
          expect(setup.captureCharFrame()).toContain("unique-tail");
        }
        expect(modal.height).toBeLessThan(16);
        expect(results.y).toBe(details.y + details.height);
      } finally {
        await act(async () => {
          await setup.dispose();
        });
      }
    },
  );

  it.each([...regions])(
    "%s keeps input/details fixed while results scroll; cancel preserves cursor and accept only reveals",
    async (region) => {
      const { setup, calls } = await renderSearch(region);
      try {
        await act(async () => {
          setup.mockInput.pressArrow("down");
        });
        await flush(setup);
        const beforeCursor = focus.getCursor(region);
        const beforeSelection = repository.selection;
        await act(async () => {
          setup.mockInput.pressKey("/");
        });
        await flush(setup);
        expect(overlay.entry?.id).toBe(`search-${region}`);
        const input = setup.renderer.root.findDescendantById(
          "feature-search-input",
        ) as InputRenderable;
        const resultScroll = setup.renderer.root.findDescendantById(
          "feature-search-results",
        ) as ScrollBoxRenderable;
        expect(input).toBeDefined();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe(input.id);
        const modal = readRenderable(setup, "modal-frame");
        const details = readRenderable(setup, "feature-search-details");
        const inputY = input.y - modal.y;
        const detailsY = details.y - modal.y;
        const queryBefore = input.value;
        await act(async () => {
          setup.mockInput.pressArrow("down");
        });
        await flush(setup);
        await act(async () => {
          setup.mockInput.pressArrow("up");
        });
        await flush(setup);
        expect(input.value).toBe(queryBefore);
        await act(async () => {
          setup.mockInput.pressKey("END");
        });
        await flush(setup);
        expect(resultScroll.scrollTop).toBeGreaterThan(0);
        expect(input.y - modal.y).toBe(inputY);
        expect(details.y - modal.y).toBe(detailsY);
        expect(focus.getCursor(region)).toBe(beforeCursor);
        const fixedInputY = input.y;
        const fixedDetailsY = details.y;
        await act(async () => {
          resultScroll.scrollTop = 0;
        });
        await flush(setup);
        expect(input.y).toBe(fixedInputY);
        expect(details.y).toBe(fixedDetailsY);
        expect(resultScroll.scrollTop).toBe(0);
        const frame = setup.captureCharFrame();
        expect(frame).toContain("Selected item");
        await act(async () => {
          input.insertText("UNIQUE-TAIL");
        });
        await flush(setup);
        expect(setup.captureCharFrame()).toContain("unique-tail");
        expect(setup.captureCharFrame()).toContain(
          region === "remotes" ? "origin/34/feature" : "34/feature",
        );
        await act(async () => {
          setup.mockInput.pressEscape();
        });
        await flush(setup);
        expect(overlay.entry).toBeNull();
        expect(focus.getCursor(region)).toBe(beforeCursor);
        expect(repository.selection).toEqual(beforeSelection);
        expect(setup.renderer.currentFocusedRenderable?.id).toBe(`region-${region}`);
        await act(async () => {
          setup.mockInput.pressKey("/");
        });
        await flush(setup);
        const field = setup.renderer.root.findDescendantById(
          "feature-search-input",
        ) as InputRenderable;
        await act(async () => {
          field.insertText("UNIQUE-TAIL");
        });
        await flush(setup);
        const callsBeforeAccept = calls.length;
        await act(async () => {
          setup.mockInput.pressEnter();
        });
        await flush(setup);
        await flush(setup);
        expect(overlay.entry).toBeNull();
        expect(focus.getCursor(region)).not.toBe(beforeCursor);
        const expectedCursor = {
          stashes: "oid-34",
          remotes: `origin/34/${longName}`,
          worktrees: `/repo/34/${longName}`,
          tags: `34/${longName}`,
        }[region];
        expect(focus.getCursor(region)).toBe(expectedCursor);
        expect(repository.selection).toEqual(beforeSelection);
        expect(
          calls
            .slice(callsBeforeAccept)
            .some((call) =>
              /^(checkout|switch|stash (apply|pop)|worktree (add|remove))/.test(call),
            ),
        ).toBeFalse();
      } finally {
        await act(async () => {
          await setup.dispose();
        });
      }
    },
  );

  it.each([...regions])(
    "%s shows empty and no-match states without changing the sidebar",
    async (region) => {
      const { setup } = await renderSearch(region, { empty: true });
      try {
        await act(async () => {
          resolveActionHandler("list.filter", region)?.();
        });
        await flush(setup);
        expect(setup.captureCharFrame()).toContain(`No ${region}`);
        const input = setup.renderer.root.findDescendantById(
          "feature-search-input",
        ) as InputRenderable;
        await act(async () => {
          input.insertText("missing");
        });
        await flush(setup);
        expect(setup.captureCharFrame()).toContain("No matches");
        await act(async () => {
          resolveActionHandler("nav.activate", "overlay")?.();
        });
        await flush(setup);
        expect(overlay.entry).not.toBeNull();
      } finally {
        await act(async () => {
          await setup.dispose();
        });
      }
    },
  );
  it.each([...regions])(
    "%s shows its read failure in the same fixed modal layout",
    async (region) => {
      const { setup } = await renderSearch(region, { fail: true });
      try {
        await act(async () => {
          resolveActionHandler("list.filter", region)?.();
        });
        await flush(setup);
        expect(setup.captureCharFrame()).toContain("Read failed:");
        expect(setup.captureCharFrame()).toContain("read unavailable");
        expect(setup.renderer.root.findDescendantById("feature-search-input")).toBeDefined();
      } finally {
        await act(async () => {
          await setup.dispose();
        });
      }
    },
  );

  it.each([...regions])(
    "%s keeps its search field fixed through loading and then displays the loaded results",
    async (region) => {
      const { setup, releaseReads } = await renderSearch(region, { loading: true });
      try {
        await act(async () => {
          resolveActionHandler("list.filter", region)?.();
        });
        await flush(setup);
        expect(setup.captureCharFrame()).toContain("Loading...");
        const input = setup.renderer.root.findDescendantById(
          "feature-search-input",
        ) as InputRenderable;
        const initialY = input.y - (setup.renderer.root.findDescendantById("modal-frame")?.y ?? 0);
        await act(async () => {
          releaseReads();
        });
        await flush(setup);
        await flush(setup);
        expect(setup.captureCharFrame()).not.toContain("Loading...");
        expect(input.y - (setup.renderer.root.findDescendantById("modal-frame")?.y ?? 0)).toBe(
          initialY,
        );
        expect(setup.captureCharFrame()).toContain("branch");
      } finally {
        releaseReads();
        await act(async () => {
          await setup.dispose();
        });
      }
    },
  );

  it("reveals a worktree beyond the sidebar render cap and keeps it mounted after navigation", async () => {
    const { setup } = await renderSearch("worktrees", { rowCount: 501 });
    const path = `/repo/0500/${longName}`;
    try {
      expect(setup.renderer.root.findDescendantById(`worktree-row:${path}`)).toBeUndefined();
      await act(async () => {
        setup.mockInput.pressKey("/");
      });
      await flush(setup);
      const input = setup.renderer.root.findDescendantById(
        "feature-search-input",
      ) as InputRenderable;
      await act(async () => {
        input.insertText("unique-tail");
      });
      await flush(setup);
      await act(async () => {
        setup.mockInput.pressEnter();
      });
      await flush(setup);
      await flush(setup);
      expect(focus.getCursor("worktrees")).toBe(path);
      expectVisible(
        setup.renderer.root.findDescendantById(`worktree-row:${path}`),
        findScrollBox(readRenderable(setup, "region-worktrees")),
      );
      await act(async () => {
        setup.mockInput.pressArrow("up");
      });
      await flush(setup);
      expect(focus.getCursor("worktrees")).not.toBe(path);
      expect(setup.renderer.root.findDescendantById(`worktree-row:${path}`)).toBeDefined();
    } finally {
      await act(async () => {
        await setup.dispose();
      });
    }
  });
});
