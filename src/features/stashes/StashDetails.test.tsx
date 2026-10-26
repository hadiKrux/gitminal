import { beforeEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, useEffect } from "react";
import { resetActionRegistry } from "@/app/hooks/useAction";
import { useRepository } from "@/app/hooks/useRepository";
import { buildListStashesArgs } from "@/domain/git/git.stashes";
import type { GitClient } from "@/domain/git/git.types";
import type { RepositorySelection, RepositorySnapshot } from "@/domain/repository/repository.types";
import { StashDetails } from "@/features/stashes/StashDetails";
import { AppTestProviders } from "@/test/app.harness";
import { createFakeGitClient, fakeGitResult } from "@/test/git.fake";

/** Joined argv of the stash list read. */
const STASH_LIST_KEY = buildListStashesArgs().join(" ");

/** Object name used by the rendered stash. */
const STASH_OBJECT_NAME = "abc1234567890";

/** Selection for the rendered stash. */
const STASH_SELECTION: RepositorySelection = {
  kind: "stash",
  objectName: STASH_OBJECT_NAME,
};

/** Selection whose object name is no longer in the snapshot. */
const MISSING_SELECTION: RepositorySelection = {
  kind: "stash",
  objectName: "gone",
};

/** Latest snapshot observed through the probe. */
let latestSnapshot: RepositorySnapshot | null = null;

/**
 * Captures the current snapshot so a test can wait for the first read.
 *
 * @returns Nothing.
 */
function RepositoryProbe(): null {
  latestSnapshot = useRepository().snapshot;

  return null;
}

/**
 * Writes one right-pane selection once the provider is mounted.
 *
 * @param props - Selection to apply.
 * @returns Nothing.
 */
function SelectionProbe(props: { readonly selection: RepositorySelection }): null {
  const repository = useRepository();

  useEffect(() => {
    repository.setSelection(props.selection);
  }, [props.selection, repository]);

  return null;
}

/**
 * Builds one NUL-separated stash list line.
 *
 * @param index - Display index.
 * @param objectName - Immutable object name.
 * @param subject - Recorded message.
 * @param committedAt - Commit timestamp in seconds.
 * @returns The recorded line.
 */
function stashLine(
  index: string,
  objectName: string,
  subject: string,
  committedAt: number,
): string {
  return [index, objectName, subject, String(committedAt)].join("\u0000");
}

/**
 * Builds a client that answers the stash read with a supplied list.
 *
 * @param stashes - Stash list output.
 * @returns The git client.
 */
function createClient(stashes: string): GitClient {
  const base = createFakeGitClient().client;

  return {
    ...base,
    invoke: async (options) => {
      if (options.args.join(" ") === STASH_LIST_KEY) {
        return fakeGitResult(stashes);
      }

      return await base.invoke(options);
    },
  };
}

/**
 * Renders the details surface with an optional selection probe.
 *
 * @param stashes - Stash list output.
 * @param selection - Selection probe value, or null for the default pending selection.
 * @returns The renderer setup.
 */
async function renderDetails(
  stashes: string,
  selection: RepositorySelection | null,
): Promise<Awaited<ReturnType<typeof testRender>>> {
  latestSnapshot = null;

  const setup = await testRender(
    <AppTestProviders gitClient={createClient(stashes)}>
      <RepositoryProbe />
      {selection === null ? null : <SelectionProbe selection={selection} />}
      <StashDetails />
    </AppTestProviders>,
    { width: 120, height: 20 },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

/**
 * Renders until a predicate holds, or the deadline passes.
 *
 * @param setup - Renderer setup.
 * @param predicate - Condition to wait for.
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

  await act(async () => {
    await setup.renderOnce();
  });
}

beforeEach(() => {
  resetActionRegistry();
  latestSnapshot = null;
});

describe("StashDetails", () => {
  it("renders the stash summary and read-only text for a stash selection", async () => {
    const committedAt = Math.floor(Date.now() / 1000) - 7_300;
    const setup = await renderDetails(
      stashLine("stash@{0}", STASH_OBJECT_NAME, "WIP on main: abc123 work", committedAt),
      STASH_SELECTION,
    );

    await waitFor(setup, () => setup.captureCharFrame().includes("Read-only."));

    const frame = setup.captureCharFrame();

    expect(frame).toContain("Stash WIP on main: abc123 work");
    expect(frame).toContain("Source branch: main");
    expect(frame).toContain("2h ago");
    expect(frame).toContain("Object: abc1234");
    expect(frame).toContain("Read-only. The stash diff is shown in the Diff panel.");
    expect(frame).not.toContain("diff --git");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("renders nothing for a non-stash selection", async () => {
    const setup = await renderDetails(
      stashLine("stash@{0}", STASH_OBJECT_NAME, "WIP on main: abc123 work", 1_700_000_000),
      null,
    );

    await waitFor(setup, () => latestSnapshot !== null);

    expect(setup.captureCharFrame()).not.toContain("Read-only.");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("explains that a selected stash no longer exists", async () => {
    const setup = await renderDetails(
      stashLine("stash@{0}", STASH_OBJECT_NAME, "WIP on main: abc123 work", 1_700_000_000),
      MISSING_SELECTION,
    );

    await waitFor(setup, () => setup.captureCharFrame().includes("Stash no longer exists"));

    expect(setup.captureCharFrame()).toContain("Stash no longer exists");

    await act(async () => {
      await setup.dispose();
    });
  });
});
