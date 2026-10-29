import { beforeEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode, useRef } from "react";
import {
  clearCommandExecution,
  recordCommandExecution,
  resetCommandOrchestration,
} from "@/app/hooks/commandRunner.state";
import { resetActionRegistry, useAction } from "@/app/hooks/useAction";
import { useFocusState } from "@/app/hooks/useFocusState";
import { useOverlay } from "@/app/hooks/useOverlay";
import { useRepository } from "@/app/hooks/useRepository";
import { describeCommandReason } from "@/domain/commands/commands.reasons";
import { getCommandDescriptor } from "@/domain/commands/commands.registry";
import type {
  CommandDescriptor,
  CommandRegion,
  CommandResult,
} from "@/domain/commands/commands.types";
import {
  PALETTE_MAX_OPTION_ROWS,
  PALETTE_MIN_OPTION_ROWS,
} from "@/features/palette/CommandPalette.constants";
import { decodePaletteValue } from "@/features/palette/CommandRow";
import {
  readRecentCommandIds,
  recordRecentCommand,
  resetRecentCommands,
} from "@/features/palette/palette.search";
import { useCommandPalette } from "@/features/palette/useCommandPalette";
import type { PaletteHandle } from "@/features/palette/useCommandPalette.types";
import { AppTestProviders } from "@/test/app.harness";
import { createFakeGitClient } from "@/test/git.fake";

/** Regions whose cursor the palette reads in these tests. */
type SeedRegion = "branches" | "remotes" | "tags" | "stashes" | "worktrees" | "diff";

/** Latest overlay context captured by the palette overlay probe. */
let latestOverlay: ReturnType<typeof useOverlay> | undefined;

/**
 * Reads the latest captured overlay context.
 *
 * A function read keeps TypeScript from narrowing the module variable to `undefined` after a reset,
 * which would hide assignments made inside a render callback.
 *
 * @returns The latest overlay context, or undefined before the first render.
 */
function readLatestOverlay(): ReturnType<typeof useOverlay> | undefined {
  return latestOverlay;
}

/** Latest palette handle captured by the probe. */
let latestPalette: PaletteHandle | undefined;

/**
 * Reads the latest captured palette handle.
 *
 * A function read keeps TypeScript from narrowing the module variable to `undefined` after a reset,
 * which would hide assignments made inside a wait predicate.
 *
 * @returns The latest handle, or undefined before the first render.
 */
function readLatestPalette(): PaletteHandle | undefined {
  return latestPalette;
}

/** Latest repository context captured by the probe. */
let latestRepository: ReturnType<typeof useRepository> | undefined;

/** Number of graph-scoped `graph.search` dispatches the probe observed. */
let graphSearchCalls = 0;

/**
 * Mounts the palette hook once the repository snapshot exists.
 *
 * @param props - Close callback and region cursors seeded before the hook captures.
 * @returns The probe content.
 */
function PaletteProbe(props: {
  readonly onClose: (afterRestore?: () => void) => void;
  readonly seed?: Partial<Record<SeedRegion, string>>;
}): ReactNode {
  latestRepository = useRepository();
  const focus = useFocusState();
  const seeded = useRef(false);

  if (!seeded.current) {
    seeded.current = true;

    for (const region of Object.keys(props.seed ?? {}) as SeedRegion[]) {
      const cursor = props.seed?.[region];

      if (cursor !== undefined) {
        focus.setCursor(region, cursor);
      }
    }
  }

  return latestRepository.snapshot === null ? (
    <text>loading</text>
  ) : (
    <PaletteHookProbe onClose={props.onClose} />
  );
}

/**
 * Captures the palette handle without rendering visible content.
 *
 * @param props - Close callback.
 * @returns A text marker.
 */
function PaletteHookProbe(props: {
  readonly onClose: (afterRestore?: () => void) => void;
}): ReactNode {
  latestPalette = useCommandPalette({ onClose: props.onClose });

  return <text>palette</text>;
}

/**
 * Mounts the palette with one graph-scoped handler registered.
 *
 * @param props - Close callback.
 * @returns The probe content.
 */
function GraphSearchPaletteProbe(props: {
  readonly onClose: (afterRestore?: () => void) => void;
}): ReactNode {
  const repository = useRepository();

  useAction("graph.search", { scope: "graph" }, () => {
    graphSearchCalls += 1;
  });

  return repository.snapshot === null ? (
    <text>loading</text>
  ) : (
    <PaletteHookProbe onClose={props.onClose} />
  );
}

/**
 * Mounts the palette as the single open overlay entry and exposes both contexts.
 *
 * @param props - Handler that records the dispatched command.
 * @returns The probe content.
 */
function PaletteOverlayProbe(props: { readonly onRun: () => void }): ReactNode {
  const repository = useRepository();
  const overlay = useOverlay();
  const entry = overlay.entry;

  latestRepository = repository;
  latestOverlay = overlay;
  useAction("graph.search", { scope: "graph" }, props.onRun);

  if (repository.snapshot === null) {
    return <text>loading</text>;
  }

  return (
    <>
      <text>palette overlay</text>
      {entry?.kind === "modal" ? entry.render({ close: overlay.close }) : null}
    </>
  );
}

/**
 * Mounts the palette hook inside the open overlay entry.
 *
 * @param props - Overlay close that accepts the post-restore completion.
 * @returns A text marker.
 */
function PaletteEntryBody(props: {
  readonly onClose: (afterRestore?: () => void) => void;
}): ReactNode {
  latestPalette = useCommandPalette({ onClose: props.onClose });

  return <text>palette entry</text>;
}

/**
 * Mounts the palette with a global fetch handler registered.
 *
 * @param props - Close callback and fetch handler.
 * @returns The probe content.
 */
function FetchPaletteProbe(props: {
  readonly onClose: (afterRestore?: () => void) => void;
  readonly onFetch: () => void;
}): ReactNode {
  latestRepository = useRepository();
  useAction("remote.fetch", { scope: "global", owner: "top-bar" }, props.onFetch);

  return latestRepository.snapshot === null ? (
    <text>loading</text>
  ) : (
    <PaletteHookProbe onClose={props.onClose} />
  );
}

/**
 * Renders until a predicate holds or the deadline passes.
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
}

/**
 * Renders the palette probe with an inert git client.
 *
 * @param seed - Region cursors to seed before capture.
 * @returns The renderer setup.
 */
async function renderPalette(
  seed?: Partial<Record<SeedRegion, string>>,
): Promise<Awaited<ReturnType<typeof testRender>>> {
  latestPalette = undefined;
  latestRepository = undefined;

  const setup = await testRender(
    <AppTestProviders gitClient={createFakeGitClient().client}>
      <PaletteProbe onClose={() => {}} seed={seed} />
    </AppTestProviders>,
    { width: 100, height: 30 },
  );

  await waitFor(setup, () => latestPalette !== undefined && latestPalette.options.length > 0);

  return setup;
}

/**
 * Reads the command ids currently rendered by the palette.
 *
 * @returns Command ids in render order, excluding group headers.
 */
function readCommandIds(): readonly string[] {
  return (latestPalette?.options ?? []).flatMap((option) => {
    const decoded = decodePaletteValue(option.value);

    return decoded?.kind === "command" ? [decoded.commandId] : [];
  });
}

/**
 * Reads the captured target of one command.
 *
 * @param commandId - Command to look up.
 * @returns The encoded target, or undefined when the command is not rendered.
 */
function readTarget(commandId: string) {
  for (const option of latestPalette?.options ?? []) {
    const decoded = decodePaletteValue(option.value);

    if (decoded?.kind === "command" && decoded.commandId === commandId) {
      return decoded.target;
    }
  }

  return undefined;
}

/**
 * Reads the option rendered for one command.
 *
 * @param commandId - Command to look up.
 * @returns The option, or undefined when the command is not rendered.
 */
function readOption(commandId: string) {
  return (latestPalette?.options ?? []).find((option) => {
    const decoded = decodePaletteValue(option.value);

    return decoded?.kind === "command" && decoded.commandId === commandId;
  });
}

/**
 * Maps a command scope to the availability region argument.
 *
 * @param scope - Command descriptor scope.
 * @returns The region the palette passes to `getAvailability`.
 */
function availabilityRegion(scope: CommandDescriptor["scope"]): CommandRegion {
  return scope === "global" ? "overlay" : scope;
}

/**
 * Runs one query change and flushes the render.
 *
 * @param setup - Renderer setup.
 * @param query - New query.
 */
async function setQuery(
  setup: Awaited<ReturnType<typeof testRender>>,
  query: string,
): Promise<void> {
  await act(async () => {
    latestPalette?.setQuery(query);
    await setup.renderOnce();
  });
}

/**
 * Asserts every disabled palette command shows its exact availability reason.
 *
 * A disabled command stays visible instead of being hidden, so its description has to explain the
 * same condition the footer and help explain for the same command, target, and region.
 *
 * @param repository - Repository context the palette rendered against.
 */
function expectDisabledReasons(repository: ReturnType<typeof useRepository>): void {
  for (const candidate of latestPalette?.options ?? []) {
    const decoded = decodePaletteValue(candidate.value);

    if (decoded?.kind !== "command") {
      continue;
    }

    const descriptor = getCommandDescriptor(decoded.commandId);

    if (descriptor === undefined) {
      continue;
    }

    const availability = repository.getAvailability(
      decoded.commandId,
      decoded.target,
      availabilityRegion(descriptor.scope),
    );

    if (availability.available) {
      continue;
    }

    expect(candidate.description, decoded.commandId).toBe(
      describeCommandReason(availability.reason ?? "command-not-implemented"),
    );
  }
}

beforeEach(() => {
  resetActionRegistry();
  resetRecentCommands();
  resetCommandOrchestration();
  graphSearchCalls = 0;
  latestOverlay = undefined;
});

describe("useCommandPalette capture", () => {
  it("lists focus.region commands and never a nav action", async () => {
    const setup = await renderPalette();
    const ids = readCommandIds();

    expect(ids).toContain("focus.region.branches");
    expect(ids).toContain("focus.region.rightPane");
    expect(ids.some((id) => id.startsWith("nav."))).toBeFalse();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("captures each target from the documented selector", async () => {
    const setup = await renderPalette({
      branches: "feature",
      remotes: "origin/main",
      tags: "v1.0.0",
      stashes: "aaa111",
      worktrees: "/repo-feature",
      diff: "working::unstaged.txt",
    });

    expect(readTarget("remote.push")).toEqual({ kind: "branch", name: "main" });
    expect(readTarget("branch.delete")).toEqual({ kind: "branch", name: "feature" });
    expect(readTarget("remote.createLocal")).toEqual({
      kind: "remoteBranch",
      remote: "origin",
      branch: "main",
    });
    expect(readTarget("tag.delete")).toEqual({ kind: "tag", name: "v1.0.0" });
    expect(readTarget("stash.delete")).toEqual({ kind: "stash", objectName: "aaa111" });
    expect(readTarget("worktree.delete")).toEqual({ kind: "worktree", path: "/repo-feature" });
    expect(readTarget("diff.stage")).toEqual({
      kind: "diffFile",
      section: "working",
      path: "unstaged.txt",
    });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps disabled commands visible with the exact availability reason", async () => {
    const setup = await renderPalette();
    const option = readOption("branch.delete");
    const repository = latestRepository;

    expect(option).toBeDefined();
    expect(option?.description).toBe(describeCommandReason("missing-target"));
    expect(repository).toBeDefined();

    if (repository !== undefined) {
      expectDisabledReasons(repository);
    }

    await act(async () => {
      await setup.dispose();
    });
  });

  it("lists graph.search with no target", async () => {
    const setup = await renderPalette();

    expect(readCommandIds()).toContain("graph.search");
    expect(readTarget("graph.search")).toEqual({ kind: "none" });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("reads a read-only diff cursor as a staged file", async () => {
    const setup = await renderPalette({ diff: "readonly::src/a.ts" });

    expect(readTarget("diff.stage")).toEqual({
      kind: "diffFile",
      section: "staged",
      path: "src/a.ts",
    });

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("useCommandPalette dispatch", () => {
  it("keeps a captured-unavailable command inert after its blocker clears", async () => {
    let settleExecution: (result: CommandResult) => void = () => {};
    const execution = new Promise<CommandResult>((resolve) => {
      settleExecution = resolve;
    });
    let fetchCalls = 0;
    let closeCalls = 0;

    recordCommandExecution(new AbortController(), execution);
    latestPalette = undefined;
    latestRepository = undefined;

    const setup = await testRender(
      <AppTestProviders gitClient={createFakeGitClient().client}>
        <FetchPaletteProbe
          onClose={() => {
            closeCalls += 1;
          }}
          onFetch={() => {
            fetchCalls += 1;
          }}
        />
      </AppTestProviders>,
      { width: 100, height: 30 },
    );

    await waitFor(setup, () => latestPalette !== undefined && latestPalette.options.length > 0);

    const option = readOption("remote.fetch:origin");

    expect(option?.description).toBe(describeCommandReason("operation-in-progress"));

    settleExecution({
      commandId: "remote.fetch",
      status: "success",
      operationLabel: "Fetch",
      steps: [],
      cwd: "/repo",
      progress: [],
    });
    clearCommandExecution(execution);

    await act(async () => {
      latestPalette?.selectValue(option?.value ?? "");
      await setup.renderOnce();
    });

    expect(fetchCalls).toBe(0);
    expect(closeCalls).toBe(0);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("does not run a command whose close completion another surface discards", async () => {
    let handlerCalls = 0;

    latestPalette = undefined;
    latestRepository = undefined;
    latestOverlay = undefined;

    const setup = await testRender(
      <AppTestProviders gitClient={createFakeGitClient().client}>
        <PaletteOverlayProbe
          onRun={() => {
            handlerCalls += 1;
          }}
        />
      </AppTestProviders>,
      { width: 100, height: 30 },
    );

    await waitFor(
      setup,
      () =>
        latestRepository !== undefined &&
        latestRepository.snapshot !== null &&
        latestOverlay !== undefined,
    );

    await act(async () => {
      readLatestOverlay()?.open({
        kind: "modal",
        id: "app.palette",
        render: ({ close }) => <PaletteEntryBody onClose={close} />,
      });
      await setup.renderOnce();
    });

    await waitFor(setup, () => latestPalette !== undefined && latestPalette.options.length > 0);

    const option = readOption("graph.search");

    expect(option).toBeDefined();

    // The error opens in the same act batch as the palette close, so the overlay discards the
    // close completion before it can dispatch. Only this same-batch window is reachable from the
    // harness; the acknowledged-then-open interleaving is argued in the overlay contract.
    await act(async () => {
      latestPalette?.selectValue(option?.value ?? "");
      readLatestOverlay()?.showError({
        commandId: "remote.fetch",
        operationLabel: "Fetch",
        message: "fatal: unrelated",
        details: "fatal: unrelated",
        consoleEntryId: null,
      });
      await setup.renderOnce();
    });

    expect(readLatestOverlay()?.entry).toBeNull();
    expect(readLatestOverlay()?.errorDetail?.message).toBe("fatal: unrelated");
    expect(handlerCalls).toBe(0);
    // Recording happens inside the completion, so a discarded dispatch is not recorded as recent.
    expect(readRecentCommandIds()).toEqual([]);

    await act(async () => {
      readLatestOverlay()?.dismissError();
      await setup.renderOnce();
    });

    expect(handlerCalls).toBe(0);
    expect(readRecentCommandIds()).toEqual([]);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("dispatches graph.search to the graph-scoped handler", async () => {
    let closeCalls = 0;

    latestPalette = undefined;
    latestRepository = undefined;

    const setup = await testRender(
      <AppTestProviders gitClient={createFakeGitClient().client}>
        <GraphSearchPaletteProbe
          onClose={(afterRestore?: () => void) => {
            closeCalls += 1;
            afterRestore?.();
          }}
        />
      </AppTestProviders>,
      { width: 100, height: 30 },
    );

    await waitFor(setup, () => latestPalette !== undefined && latestPalette.options.length > 0);

    const option = readOption("graph.search");

    expect(option).toBeDefined();

    await act(async () => {
      latestPalette?.selectValue(option?.value ?? "");
      await setup.renderOnce();
    });

    await waitFor(setup, () => graphSearchCalls === 1);

    expect(graphSearchCalls).toBe(1);
    expect(closeCalls).toBe(1);
    // The completion records the dispatched command exactly once.
    expect(readRecentCommandIds()).toEqual(["graph.search"]);

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("useCommandPalette filtering", () => {
  it("matches case-insensitively on the label", async () => {
    const setup = await renderPalette();

    await setQuery(setup, "REFRESH");

    expect(readCommandIds()).toContain("app.refresh");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("matches the description, keywords, and effective shortcut", async () => {
    const setup = await renderPalette();

    await setQuery(setup, "force-with-lease");
    expect(readCommandIds()).toContain("remote.pushForceSafe");

    await setQuery(setup, "prune");
    expect(readCommandIds()).toContain("remote.fetchPrune");

    await setQuery(setup, "ctrl+p");
    expect(readCommandIds()).toContain("app.palette");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("reports no matches without hiding the query", async () => {
    const setup = await renderPalette();

    await setQuery(setup, "nothing-matches-this");

    expect(latestPalette?.matchCount).toBe(0);
    expect(latestPalette?.options).toHaveLength(0);

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("useCommandPalette bounds", () => {
  it("clamps the option window to the documented maximum", async () => {
    const setup = await renderPalette();

    expect(latestPalette?.optionRows).toBe(PALETTE_MAX_OPTION_ROWS);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps at least one option row on a terminal smaller than the chrome", async () => {
    latestPalette = undefined;
    latestRepository = undefined;

    const setup = await testRender(
      <AppTestProviders gitClient={createFakeGitClient().client}>
        <PaletteProbe onClose={() => {}} />
      </AppTestProviders>,
      { width: 60, height: 4 },
    );

    await waitFor(setup, () => latestPalette !== undefined);

    expect(readLatestPalette()?.optionRows).toBe(PALETTE_MIN_OPTION_ROWS);

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("session recents", () => {
  it("caps the list at five and deduplicates by command id", () => {
    for (const commandId of [
      "app.refresh",
      "app.help",
      "app.quit",
      "app.console",
      "app.palette",
      "app.themePicker",
    ]) {
      recordRecentCommand(commandId);
    }

    recordRecentCommand("app.refresh");

    expect(readRecentCommandIds()).toEqual([
      "app.refresh",
      "app.themePicker",
      "app.palette",
      "app.console",
      "app.quit",
    ]);
  });

  it("renders the recents group ahead of the category groups", async () => {
    recordRecentCommand("app.refresh");

    const setup = await renderPalette();
    const options = latestPalette?.options ?? [];

    expect(options[0]?.name).toBe("-- Recent --");
    expect(options[1]?.name.startsWith("Recent: Refresh")).toBeTrue();
    expect(options.some((option) => option.name === "-- App --")).toBeTrue();

    await act(async () => {
      await setup.dispose();
    });
  });
});
