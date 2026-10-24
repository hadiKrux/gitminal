import { beforeEach, describe, expect, it } from "bun:test";
import type { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { resetActionRegistry } from "@/app/hooks/useAction";
import type { GitClient } from "@/domain/git/git.types";
import { MoreMenu } from "@/features/top-bar/MoreMenu";
import { MORE_MENU_SELECT_ID } from "@/features/top-bar/MoreMenu.constants";
import { MoreMenuLive } from "@/features/top-bar/MoreMenuLive";
import type { TopBarMoreOption } from "@/features/top-bar/useTopBar.types";
import { AppTestProviders } from "@/test/app.harness";
import { fakeGitResult } from "@/test/git.fake";
import { ShellTestProviders } from "@/test/shell.harness";

/**
 * Builds the five More menu options.
 *
 * @param available - Command ids that should be available.
 * @param reason - Reason used for every unavailable option.
 * @returns Options in display order.
 */
function buildOptions(
  available: readonly string[] = [],
  reason: string = "no remote",
): readonly TopBarMoreOption[] {
  const rows = [
    ["remote.fetch", "Fetch", "Fetch the upstream refs of local branches"],
    ["remote.fetchPrune", "Fetch --prune", "Fetch and delete remote tracking refs confirmed gone"],
    ["remote.pushForceSafe", "Push force (safe)", "Push with --force-with-lease"],
    ["remote.pushForceOverwrite", "Push force (overwrite)", "Push with --force"],
    ["remote.pushNoVerify", "Push --no-verify", "Push with --no-verify"],
  ] as const;

  return rows.map(([commandId, label, description]) => {
    const isAvailable = available.includes(commandId);

    return {
      commandId,
      label,
      description: isAvailable ? description : reason,
      available: isAvailable,
      reason: isAvailable ? null : reason,
    };
  });
}

/**
 * Renders the More menu.
 *
 * @param options - Menu options.
 * @param onSelect - Selection callback.
 * @returns The renderer setup.
 */
async function renderMenu(
  options: readonly TopBarMoreOption[],
  onSelect: (commandId: string) => void,
): Promise<Awaited<ReturnType<typeof testRender>>> {
  return testRender(
    <ShellTestProviders>
      <MoreMenu options={options} onSelect={onSelect} />
    </ShellTestProviders>,
    { width: 100, height: 30 },
  );
}

describe("MoreMenu", () => {
  beforeEach(() => {
    resetActionRegistry();
  });

  it("renders the five options with their descriptions", async () => {
    const setup = await renderMenu(buildOptions(), () => {});

    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();

    for (const label of [
      "Fetch",
      "Fetch --prune",
      "Push force (safe)",
      "Push force (overwrite)",
      "Push --no-verify",
    ]) {
      expect(frame, label).toContain(label);
    }

    expect(frame).toContain("no remote");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the menu open and shows the reason when an unavailable option is selected", async () => {
    const selected: string[] = [];
    const setup = await renderMenu(buildOptions(["remote.pushNoVerify"], "detached HEAD"), (id) =>
      selected.push(id),
    );

    await act(async () => {
      await setup.renderOnce();
    });

    const select = setup.renderer.root.findDescendantById(MORE_MENU_SELECT_ID) as
      | SelectRenderable
      | undefined;

    await act(async () => {
      select?.setSelectedIndex(0);
      select?.selectCurrent();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();

    expect(selected).toEqual([]);
    expect(frame).toContain("More remote actions");
    expect(frame).toContain("! detached HEAD");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("dispatches the explicit command id of an available option", async () => {
    const selected: string[] = [];
    const setup = await renderMenu(buildOptions(["remote.pushForceSafe"]), (id) =>
      selected.push(id),
    );

    await act(async () => {
      await setup.renderOnce();
    });

    const select = setup.renderer.root.findDescendantById(MORE_MENU_SELECT_ID) as
      | SelectRenderable
      | undefined;

    await act(async () => {
      select?.setSelectedIndex(2);
      select?.selectCurrent();
    });

    expect(selected).toEqual(["remote.pushForceSafe"]);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("dispatches each available option's own command id", async () => {
    const selected: string[] = [];
    const setup = await renderMenu(
      buildOptions(["remote.fetchPrune", "remote.pushNoVerify"]),
      (id) => selected.push(id),
    );

    await act(async () => {
      await setup.renderOnce();
    });

    const select = setup.renderer.root.findDescendantById(MORE_MENU_SELECT_ID) as
      | SelectRenderable
      | undefined;

    await act(async () => {
      select?.setSelectedIndex(1);
      select?.selectCurrent();
    });
    await act(async () => {
      select?.setSelectedIndex(4);
      select?.selectCurrent();
    });

    expect(selected).toEqual(["remote.fetchPrune", "remote.pushNoVerify"]);

    await act(async () => {
      await setup.dispose();
    });
  });
  it("updates availability reasons after the repository read settles while open", async () => {
    let releaseStatus: () => void = () => {};
    let holding = false;
    const gate = new Promise<void>((resolve) => {
      releaseStatus = resolve;
    });
    const client: GitClient = {
      gitPath: "git",
      invoke: async (options) => {
        const key = options.args.join(" ");

        if (key === "status --porcelain=v2 --branch -z --untracked-files=all") {
          if (!holding) {
            holding = true;
            await gate;
          }

          return fakeGitResult(
            "# branch.oid abc123\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +0 -0\0",
          );
        }

        const answers: Readonly<Record<string, () => ReturnType<typeof fakeGitResult>>> = {
          "rev-parse --is-inside-work-tree": () => fakeGitResult("true\n"),
          "rev-parse --is-bare-repository --absolute-git-dir": () =>
            fakeGitResult("false\n/repo/.git\n"),
          "rev-parse --show-toplevel": () => fakeGitResult("/repo\n"),
          "rev-parse --verify HEAD": () => fakeGitResult("abc123\n"),
          "symbolic-ref -q --short HEAD": () => fakeGitResult("main\n"),
          "rev-parse --verify --quiet MERGE_HEAD": () => fakeGitResult("", false),
          "rev-parse --verify --quiet REBASE_HEAD": () => fakeGitResult("", false),
          "rev-parse --verify --quiet CHERRY_PICK_HEAD": () => fakeGitResult("", false),
          "remote -v": () => fakeGitResult(""),
          "config user.name": () => fakeGitResult("Test User\n"),
          "config user.email": () => fakeGitResult("test@example.com\n"),
          "for-each-ref --format=%(upstream:remotename)%09%(upstream:remoteref) refs/heads/main":
            () => fakeGitResult(""),
          "for-each-ref --format=%(upstream:short) refs/heads": () => fakeGitResult(""),
          "rev-parse --verify --quiet refs/remotes/origin/main": () => fakeGitResult("", false),
        };

        const answer = answers[key];

        return answer === undefined ? fakeGitResult("", false) : answer();
      },
    };
    const setup = await testRender(
      <AppTestProviders gitClient={client}>
        <MoreMenuLive onSelect={() => {}} />
      </AppTestProviders>,
      { width: 100, height: 20 },
    );

    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).toContain("loading repository");

    await act(async () => {
      releaseStatus();
      await new Promise((resolve) => setTimeout(resolve, 10));
      await setup.renderOnce();
    });

    const deadline = Date.now() + 2_000;

    while (!setup.captureCharFrame().includes("no remote") && Date.now() < deadline) {
      await act(async () => {
        await setup.renderOnce();
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
    }

    const frame = setup.captureCharFrame();

    expect(frame).toContain("no remote");
    expect(frame).not.toContain("loading repository");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("clears a stale unavailable warning when the selected option becomes available", async () => {
    let releaseStatus: () => void = () => {};
    let holding = false;
    const gate = new Promise<void>((resolve) => {
      releaseStatus = resolve;
    });
    const client: GitClient = {
      gitPath: "git",
      invoke: async (options) => {
        const key = options.args.join(" ");

        if (key === "status --porcelain=v2 --branch -z --untracked-files=all") {
          if (!holding) {
            holding = true;
            await gate;
          }

          return fakeGitResult(
            "# branch.oid abc123\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +0 -0\0",
          );
        }

        const answers: Readonly<Record<string, () => ReturnType<typeof fakeGitResult>>> = {
          "rev-parse --is-inside-work-tree": () => fakeGitResult("true\n"),
          "rev-parse --is-bare-repository --absolute-git-dir": () =>
            fakeGitResult("false\n/repo/.git\n"),
          "rev-parse --show-toplevel": () => fakeGitResult("/repo\n"),
          "rev-parse --verify HEAD": () => fakeGitResult("abc123\n"),
          "symbolic-ref -q --short HEAD": () => fakeGitResult("main\n"),
          "rev-parse --verify --quiet MERGE_HEAD": () => fakeGitResult("", false),
          "rev-parse --verify --quiet REBASE_HEAD": () => fakeGitResult("", false),
          "rev-parse --verify --quiet CHERRY_PICK_HEAD": () => fakeGitResult("", false),
          "remote -v": () => fakeGitResult("origin\tgit@example.com:repo.git (fetch)\n"),
          "config user.name": () => fakeGitResult("Test User\n"),
          "config user.email": () => fakeGitResult("test@example.com\n"),
          "for-each-ref --format=%(upstream:remotename)%09%(upstream:remoteref) refs/heads/main":
            () => fakeGitResult("origin\trefs/heads/main\n"),
          "for-each-ref --format=%(upstream:short) refs/heads": () =>
            fakeGitResult("origin/main\n"),
          "rev-parse --verify --quiet refs/remotes/origin/main": () => fakeGitResult("abc123\n"),
        };

        const answer = answers[key];

        return answer === undefined ? fakeGitResult("", false) : answer();
      },
    };
    const setup = await testRender(
      <AppTestProviders gitClient={client}>
        <MoreMenuLive onSelect={() => {}} />
      </AppTestProviders>,
      { width: 100, height: 20 },
    );

    await act(async () => {
      await setup.renderOnce();
    });

    const select = setup.renderer.root.findDescendantById(MORE_MENU_SELECT_ID) as
      | SelectRenderable
      | undefined;

    await act(async () => {
      select?.setSelectedIndex(0);
      select?.selectCurrent();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).toContain("! loading repository");

    await act(async () => {
      releaseStatus();
      await new Promise((resolve) => setTimeout(resolve, 10));
      await setup.renderOnce();
    });

    const deadline = Date.now() + 2_000;

    while (
      !setup.captureCharFrame().includes("Fetch the upstream refs of local branches") &&
      Date.now() < deadline
    ) {
      await act(async () => {
        await setup.renderOnce();
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
    }

    const frame = setup.captureCharFrame();

    expect(frame).toContain("Fetch the upstream refs of local branches");
    expect(frame).not.toContain("! loading repository");

    await act(async () => {
      await setup.dispose();
    });
  });
});
