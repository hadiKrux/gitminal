import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { type CapturedFrame, type CapturedSpan, RGBA } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import {
  isCommandOrchestrationActive,
  resetCommandOrchestration,
} from "@/app/hooks/commandRunner.state";
import {
  getActionRegistryVersion,
  hasRegisteredAction,
  resetActionRegistry,
  resolveActionHandler,
} from "@/app/hooks/useAction";
import { useConfig } from "@/app/hooks/useConfig";
import { useFocusRegion } from "@/app/hooks/useFocusRegion";
import { useHotkeys } from "@/app/hooks/useHotkeys";
import { useOverlay } from "@/app/hooks/useOverlay";
import { useStatus } from "@/app/hooks/useStatus";
import { getAvailability } from "@/domain/commands/commands.availability";
import { registerCommandHandler, resetCommandRunner } from "@/domain/commands/commands.runner";
import type {
  CommandAvailability,
  CommandOperation,
  CommandRequest,
  CommandTarget,
} from "@/domain/commands/commands.types";
import { DEFAULT_CONFIG } from "@/domain/config/config.defaults";
import type { ConfigFilePaths, RemoteFetchScope } from "@/domain/config/config.types";
import type { GitClient } from "@/domain/git/git.types";
import {
  createRepositorySignals,
  detectRepositoryState,
} from "@/domain/repository/repository.states";
import type { RepositorySignals } from "@/domain/repository/repository.types";
import { DEFAULT_THEME_NAME, THEME_FLAVORS } from "@/domain/theme/theme.catppuccin";
import { TopBar } from "@/features/top-bar/TopBar";
import { TopBarActions } from "@/features/top-bar/TopBarActions";
import { TopBarStatus } from "@/features/top-bar/TopBarStatus";
import { calculateTopBarBudgets } from "@/features/top-bar/topBar.budgets";
import {
  buildTopBarControls,
  buildTopBarMoreOptions,
  resolveCommandTarget,
} from "@/features/top-bar/topBar.controls";
import type { TopBarControl, TopBarStatusMode } from "@/features/top-bar/useTopBar.types";
import { buildForcePushDescription } from "@/features/top-bar/useTopBarCommands";
import { AppTestProviders, type ConfigSnapshot, type ConfigSource } from "@/test/app.harness";
import { createFakeGitClient } from "@/test/git.fake";
import { ShellTestProviders } from "@/test/shell.harness";
import { ICONS } from "@/theme/icons";

/** Latest status context captured by the probe. */
let latestStatus: ReturnType<typeof useStatus> | undefined;

/** Latest overlay context captured by the probe. */
let latestOverlay: ReturnType<typeof useOverlay> | undefined;

/** Latest configuration context captured by the probe. */
let latestConfig: ReturnType<typeof useConfig> | undefined;

/** Resolved paths used by the fetch-scope configuration snapshots. */
const FETCH_SCOPE_PATHS: ConfigFilePaths = Object.freeze({
  config: "/cfg/config.json",
  keybindings: "/cfg/keybindings.json",
  theme: "/cfg/theme.json",
});

/** The global remote actions the top bar owns. */
const REMOTE_ACTIONS: readonly string[] = [
  "remote.pull",
  "remote.push",
  "remote.fetch",
  "remote.fetchPrune",
  "remote.pushForceSafe",
  "remote.pushForceOverwrite",
  "remote.pushNoVerify",
  "remote.more",
];

/** The top-bar-scope navigation actions the top bar owns. */
const TOP_BAR_ACTIONS: readonly string[] = ["nav.left", "nav.right", "nav.activate"];

/** A readable repository signal set with an upstream. */
const BASE_SIGNALS: Partial<RepositorySignals> = {
  loaded: true,
  insideWorkTree: true,
  headExists: true,
  branch: "main",
  upstream: "origin/main",
  upstreamExists: true,
  upstreamCheck: "checked",
  remotes: ["origin"],
  hasUpstreamBranches: true,
};

/**
 * Builds an availability reader for one repository scenario.
 *
 * @param overrides - Signal values that describe the scenario.
 * @param operation - Whether a mutation is running.
 * @returns The availability reader.
 */
function scenario(
  overrides: Partial<RepositorySignals> = {},
  operation: CommandOperation = "idle",
): (commandId: string, target: CommandTarget) => CommandAvailability {
  const signals = createRepositorySignals({ ...BASE_SIGNALS, ...overrides });
  const state = detectRepositoryState(signals);

  return (commandId, target) =>
    getAvailability(commandId, { state, signals, target, region: "top-bar", operation });
}

/** Idle status mode used by the rendered budget test. */
const BUDGET_IDLE_MODE: TopBarStatusMode = {
  kind: "idle",
  loading: false,
  initialError: null,
  gated: false,
  branchLabel: "main",
  detached: false,
  upstreamLabel: "origin/main",
  upstreamMissing: false,
  ahead: 0,
  behind: 0,
  sync: "up-to-date",
  stateLabel: null,
};

/**
 * Builds controls with two maximum-length disabled reasons.
 *
 * @returns The controls in display order.
 */
function buildBudgetControls(): readonly TopBarControl[] {
  return [
    { kind: "info", label: "Branch", available: true, reason: null },
    {
      kind: "pull",
      label: "Pull",
      icon: ICONS.pull,
      available: false,
      reason: "upstream gone; push to recreate it",
    },
    {
      kind: "push",
      label: "Push",
      icon: ICONS.push,
      available: false,
      reason: "no upstream; use Push to create it first.",
    },
    { kind: "more", label: "More", icon: ICONS.ellipsis, available: true, reason: null },
  ];
}

/**
 * Renders the status strip and the action strip through the real budget split.
 *
 * @param props - Terminal width.
 * @returns The one-row frame.
 */
function BudgetRow(props: { readonly width: number }): ReactNode {
  const controls = buildBudgetControls();
  const reasons = controls
    .filter((control) => control.kind !== "info" && !control.available)
    .map((control) => control.reason ?? "");
  const budgets = calculateTopBarBudgets(props.width, reasons);

  return (
    <box flexDirection="column" width={props.width} height={2}>
      <box flexDirection="row" height={1}>
        <box flexGrow={1} flexShrink={1} height={1} overflow="hidden">
          <TopBarStatus mode={BUDGET_IDLE_MODE} width={budgets.statusWidth} />
        </box>
        <box flexDirection="row" height={1} flexShrink={0} marginRight={1}>
          <TopBarActions
            controls={controls}
            focusedKind="info"
            reasonWidth={budgets.reasonWidth}
            onActivate={() => {}}
          />
        </box>
      </box>
    </box>
  );
}

/**
 * Finds one control by kind.
 *
 * @param controls - Controls to search.
 * @param kind - Control kind.
 * @returns The matching control.
 */
function controlOfKind(
  controls: ReturnType<typeof buildTopBarControls>,
  kind: string,
): ReturnType<typeof buildTopBarControls>[number] {
  const control = controls.find((candidate) => candidate.kind === kind);

  if (control === undefined) {
    throw new Error(`missing control ${kind}`);
  }

  return control;
}

/**
 * Captures the overlay and status contexts and renders the top bar in a focusable region.
 *
 * @returns The harness layout.
 */
function Harness(): ReactNode {
  const region = useFocusRegion("top-bar");

  latestStatus = useStatus();
  latestOverlay = useOverlay();
  latestConfig = useConfig();
  useHotkeys();

  return (
    <box {...region.regionProps} flexDirection="column" width={120} height={4} flexShrink={0}>
      <TopBar />
    </box>
  );
}

/**
 * Builds one configuration snapshot with a chosen fetch scope.
 *
 * @param scope - Effective `remote.fetchScope`.
 * @returns The configuration snapshot.
 */
function buildFetchScopeSnapshot(scope: RemoteFetchScope): ConfigSnapshot {
  return {
    status: "missing",
    config: { ...DEFAULT_CONFIG, remote: { fetchScope: scope } },
    paths: FETCH_SCOPE_PATHS,
    files: [],
    warnings: [],
    keybindingsFile: {},
    themeOverrides: null,
  };
}

/**
 * Builds a source that reloads to one fetch scope.
 *
 * @param scope - Effective `remote.fetchScope` after the reload.
 * @returns The configuration source.
 */
function buildFetchScopeSource(scope: RemoteFetchScope): ConfigSource {
  return {
    paths: FETCH_SCOPE_PATHS,
    load: async (): Promise<ConfigSnapshot> => buildFetchScopeSnapshot(scope),
  };
}

/**
 * Renders the top bar inside the provider stack it needs.
 *
 * @param client - Git client, when a scenario needs its own reads.
 * @param configSnapshot - Startup configuration snapshot.
 * @param configSource - Reload source, when the scenario reloads configuration.
 * @returns The renderer setup.
 */
async function renderTopBar(
  client?: GitClient,
  configSnapshot?: ConfigSnapshot,
  configSource?: ConfigSource,
): Promise<Awaited<ReturnType<typeof testRender>>> {
  latestStatus = undefined;
  latestOverlay = undefined;
  latestConfig = undefined;

  return testRender(
    <AppTestProviders
      gitClient={client ?? createFakeGitClient().client}
      configSnapshot={configSnapshot}
      configSource={configSource}
    >
      <box flexDirection="column" width={120} height={8}>
        <Harness />
      </box>
    </AppTestProviders>,
    { width: 120, height: 8, kittyKeyboard: true },
  );
}

/**
 * Renders until the initial repository read reaches the top bar.
 *
 * @param setup - Renderer setup.
 */
async function waitForBranch(setup: Awaited<ReturnType<typeof testRender>>): Promise<void> {
  const deadline = Date.now() + 2_000;

  while (!setup.captureCharFrame().includes("origin/main") && Date.now() < deadline) {
    await act(async () => {
      await setup.renderOnce();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

/**
 * Focuses the top-bar region frame.
 *
 * @param setup - Renderer setup.
 */
async function focusTopBar(setup: Awaited<ReturnType<typeof testRender>>): Promise<void> {
  await act(async () => {
    setup.renderer.root.findDescendantById("region-top-bar")?.focus();
  });
  await act(async () => {
    await setup.renderOnce();
  });
}

/**
 * Presses one key and renders once.
 *
 * @param setup - Renderer setup.
 * @param key - Key to press.
 */
async function pressKey(
  setup: Awaited<ReturnType<typeof testRender>>,
  key: "right" | "left" | "more" | "enter" | "escape",
): Promise<void> {
  await act(async () => {
    if (key === "more") {
      setup.mockInput.pressKey(".");
      return;
    }

    if (key === "enter") {
      setup.mockInput.pressEnter();
      return;
    }

    if (key === "escape") {
      setup.mockInput.pressEscape();
      return;
    }

    setup.mockInput.pressArrow(key);
  });
  await act(async () => {
    await setup.renderOnce();
  });
}

/**
 * Finds the captured span for one button run.
 *
 * A disabled button renders its icon and its reason in the same run, so the span is matched by
 * containment rather than equality. Several spans can contain the same short ASCII icon, so the
 * expected background color selects the button run and a stray text run cannot satisfy the check.
 *
 * @param frame - Captured frame with colored spans.
 * @param text - Text the span must contain.
 * @param expected - Expected background token value.
 * @returns The matching span.
 * @throws When no span matches.
 */
function findSpanContaining(frame: CapturedFrame, text: string, expected: string): CapturedSpan {
  for (const line of frame.lines) {
    for (const span of line.spans) {
      if (span.text.includes(text) && span.bg.equals(RGBA.fromHex(expected))) {
        return span;
      }
    }
  }

  throw new Error(`No captured span contains ${text} with background ${expected}`);
}

/**
 * Asserts a button's focus state through its background token.
 *
 * @param frame - Captured frame with colored spans.
 * @param text - Button label text.
 * @param focused - Whether the button should render the focused background.
 */
function expectButtonFocused(frame: CapturedFrame, text: string, focused: boolean): void {
  const tokens = THEME_FLAVORS[DEFAULT_THEME_NAME].tokens;
  const expected = focused ? tokens.selection : tokens.border;

  findSpanContaining(frame, text, expected);
}

beforeEach(() => {
  resetActionRegistry();
  resetCommandRunner();
  resetCommandOrchestration();
});

afterEach(() => {
  resetCommandRunner();
  resetCommandOrchestration();
});

describe("buildTopBarControls", () => {
  it("orders the controls as info, Pull, Push, More while idle", () => {
    const controls = buildTopBarControls({
      branch: "main",
      running: false,
      hasActiveStatus: false,
      getAvailability: scenario(),
    });

    expect(controls.map((control) => control.kind)).toEqual(["info", "pull", "push", "more"]);
    expect(controlOfKind(controls, "pull").available).toBe(true);
    expect(controlOfKind(controls, "push").available).toBe(true);
    expect(controlOfKind(controls, "more").available).toBe(true);
  });

  it("drops the info control while an operation or a message is showing", () => {
    const running = buildTopBarControls({
      branch: "main",
      running: true,
      hasActiveStatus: false,
      getAvailability: scenario({ operationRunning: true }, "running"),
    });
    const messaged = buildTopBarControls({
      branch: "main",
      running: false,
      hasActiveStatus: true,
      getAvailability: scenario(),
    });

    expect(running.map((control) => control.kind)).toEqual(["pull", "push", "more"]);
    expect(messaged.map((control) => control.kind)).toEqual(["pull", "push", "more"]);
  });

  it("blocks Pull and Push on a detached HEAD", () => {
    const controls = buildTopBarControls({
      branch: "",
      running: false,
      hasActiveStatus: false,
      getAvailability: scenario({
        branch: null,
        detached: true,
        shortHash: "abc1234",
        upstream: null,
        upstreamCheck: "none",
      }),
    });

    expect(controlOfKind(controls, "pull").reason).toBe("detached HEAD");
    expect(controlOfKind(controls, "push").reason).toBe("detached HEAD");
    expect(controlOfKind(controls, "more").available).toBe(true);
  });

  it("keeps Push available without an upstream but blocks Pull and the force variants", () => {
    const reader = scenario({ upstream: null, upstreamCheck: "none" });
    const controls = buildTopBarControls({
      branch: "main",
      running: false,
      hasActiveStatus: false,
      getAvailability: reader,
    });
    const options = buildTopBarMoreOptions({ branch: "main", getAvailability: reader });

    expect(controlOfKind(controls, "pull").reason).toBe(
      "no upstream; use Push to create it first.",
    );
    expect(controlOfKind(controls, "push").available).toBe(true);
    expect(options.find((option) => option.commandId === "remote.pushForceSafe")?.reason).toBe(
      "no upstream; use Push to create it first.",
    );
  });

  it("blocks Pull when the upstream is gone and keeps Push available", () => {
    const reader = scenario({ upstreamExists: false });
    const controls = buildTopBarControls({
      branch: "main",
      running: false,
      hasActiveStatus: false,
      getAvailability: reader,
    });
    const options = buildTopBarMoreOptions({ branch: "main", getAvailability: reader });

    expect(controlOfKind(controls, "pull").reason).toBe("upstream gone; push to recreate it");
    expect(controlOfKind(controls, "push").available).toBe(true);
    expect(options.find((option) => option.commandId === "remote.pushForceOverwrite")?.reason).toBe(
      "upstream gone; push to recreate it",
    );
  });

  it("blocks every remote action with no remote but keeps the More control available", () => {
    const reader = scenario({ remotes: [] });
    const controls = buildTopBarControls({
      branch: "main",
      running: false,
      hasActiveStatus: false,
      getAvailability: reader,
    });
    const options = buildTopBarMoreOptions({ branch: "main", getAvailability: reader });

    expect(controlOfKind(controls, "pull").reason).toBe("no remote");
    expect(controlOfKind(controls, "push").reason).toBe("no remote");
    expect(controlOfKind(controls, "more").available).toBe(true);

    expect(options).toHaveLength(5);

    for (const option of options) {
      expect(option.available, option.commandId).toBe(false);
      expect(option.reason, option.commandId).toBe("no remote");
    }
  });

  it("reports no commits yet for Push in an empty repository", () => {
    const reader = scenario({
      headExists: false,
      upstream: null,
      upstreamCheck: "none",
      hasUpstreamBranches: false,
    });
    const controls = buildTopBarControls({
      branch: "main",
      running: false,
      hasActiveStatus: false,
      getAvailability: reader,
    });
    const options = buildTopBarMoreOptions({ branch: "main", getAvailability: reader });

    expect(controlOfKind(controls, "push").reason).toBe("no commits yet");
    expect(options.find((option) => option.commandId === "remote.fetch")?.reason).toBeNull();
  });

  it("blocks mutations while an operation is running", () => {
    const controls = buildTopBarControls({
      branch: "main",
      running: true,
      hasActiveStatus: false,
      getAvailability: scenario({ operationRunning: true }, "running"),
    });

    expect(controlOfKind(controls, "pull").reason).toBe("operation in progress");
    expect(controlOfKind(controls, "push").reason).toBe("operation in progress");
    expect(controlOfKind(controls, "more").available).toBe(true);
  });
});

describe("buildTopBarMoreOptions", () => {
  it("orders the five options and uses the normal description when available", () => {
    const options = buildTopBarMoreOptions({ branch: "main", getAvailability: scenario() });

    expect(options.map((option) => option.commandId)).toEqual([
      "remote.fetch",
      "remote.fetchPrune",
      "remote.pushForceSafe",
      "remote.pushForceOverwrite",
      "remote.pushNoVerify",
    ]);

    for (const option of options) {
      expect(option.available, option.commandId).toBe(true);
      expect(option.reason, option.commandId).toBeNull();
      expect(option.description.length, option.commandId).toBeGreaterThan(0);
    }
  });
});

describe("top-bar fetch scope", () => {
  it("sends the same fetch request from the top bar and the palette after reload", async () => {
    const requests: CommandRequest[] = [];
    const cleanup = registerCommandHandler({
      commandId: "remote.fetch",
      operationLabel: "Fetch",
      handler: async (context) => {
        requests.push(context.request);

        return { steps: [] };
      },
    });
    const setup = await renderTopBar(
      createFakeGitClient().client,
      buildFetchScopeSnapshot("current"),
      buildFetchScopeSource("local"),
    );

    await waitForBranch(setup);
    await focusTopBar(setup);

    await act(async () => {
      setup.mockInput.pressKey("f");
      await setup.renderOnce();
    });
    await waitForRequestCount(setup, requests, 1);
    await waitForIdle(setup);

    expect(requests[0]?.formValues).toBeUndefined();

    await act(async () => {
      await latestConfig?.reload();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      setup.mockInput.pressKey("f");
      await setup.renderOnce();
    });
    await waitForRequestCount(setup, requests, 2);
    await waitForIdle(setup);

    await act(async () => {
      resolveActionHandler("remote.fetch", "global")?.();
      await setup.renderOnce();
    });
    await waitForRequestCount(setup, requests, 3);

    expect(requests[1]?.formValues).toBeUndefined();
    expect(requests[2]?.formValues).toEqual(requests[1]?.formValues);

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  /**
   * Renders until a number of fetch requests has been recorded.
   *
   * @param setup - Renderer setup.
   * @param requests - Recorded requests.
   * @param count - Expected request count.
   */
  async function waitForRequestCount(
    setup: Awaited<ReturnType<typeof testRender>>,
    requests: readonly CommandRequest[],
    count: number,
  ): Promise<void> {
    const deadline = Date.now() + 2_000;

    while (requests.length < count && Date.now() < deadline) {
      await act(async () => {
        await setup.renderOnce();
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
    }
  }

  /**
   * Renders until the command orchestrator has released its single slot.
   *
   * @param setup - Renderer setup.
   */
  async function waitForIdle(setup: Awaited<ReturnType<typeof testRender>>): Promise<void> {
    const deadline = Date.now() + 2_000;

    while (isCommandOrchestrationActive() && Date.now() < deadline) {
      await act(async () => {
        await setup.renderOnce();
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
    }
  }
});

describe("rendered top-bar budgets", () => {
  it("keeps the branch and two maximum reasons readable at 80 and 100 columns", async () => {
    for (const width of [80, 100]) {
      const setup = await testRender(
        <ShellTestProviders>
          <BudgetRow width={width} />
        </ShellTestProviders>,
        { width, height: 4 },
      );

      await act(async () => {
        await setup.renderOnce();
      });

      const frame = setup.captureCharFrame();

      expect(frame, `${width}`).toContain("main");
      expect(frame, `${width}`).toContain("upstream go");
      expect(frame, `${width}`).toContain("no upstream");
      expect(frame, `${width}`).toContain(ICONS.pull);
      expect(frame, `${width}`).toContain(ICONS.push);

      await act(async () => {
        await setup.dispose();
      });
    }
  });
});

describe("resolveCommandTarget", () => {
  it("targets the current branch for branch commands and no target for fetch", () => {
    expect(resolveCommandTarget("remote.pull", "main")).toEqual({ kind: "branch", name: "main" });
    expect(resolveCommandTarget("remote.push", "main")).toEqual({ kind: "branch", name: "main" });
    expect(resolveCommandTarget("remote.pushForceSafe", "main")).toEqual({
      kind: "branch",
      name: "main",
    });
    expect(resolveCommandTarget("remote.pushNoVerify", "main")).toEqual({
      kind: "branch",
      name: "main",
    });
    expect(resolveCommandTarget("remote.fetch", "main")).toEqual({ kind: "none" });
    expect(resolveCommandTarget("remote.fetchPrune", "main")).toEqual({ kind: "none" });
  });
});

describe("buildForcePushDescription", () => {
  it("names the branch and upstream and states the consequence", () => {
    const safe = buildForcePushDescription({
      destructive: false,
      branch: "main",
      upstream: "origin/main",
    });
    const overwrite = buildForcePushDescription({
      destructive: true,
      branch: "main",
      upstream: "origin/main",
    });

    expect(safe).toContain("main -> origin/main");
    expect(safe).toContain("not fetched");
    expect(overwrite).toContain("main -> origin/main");
    expect(overwrite).toContain("can be lost");
  });
});

describe("useTopBar", () => {
  it("registers every remote action once in the global scope and the nav actions in top-bar", async () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    const versionBefore = getActionRegistryVersion();
    const setup = await renderTopBar();

    await waitForBranch(setup);

    for (const actionId of REMOTE_ACTIONS) {
      expect(hasRegisteredAction(actionId, "global"), actionId).toBe(true);
    }

    for (const actionId of TOP_BAR_ACTIONS) {
      expect(hasRegisteredAction(actionId, "top-bar"), actionId).toBe(true);
    }

    expect(hasRegisteredAction("remote.fetch", "global")).toBe(true);
    expect(getActionRegistryVersion() - versionBefore).toBe(
      REMOTE_ACTIONS.length + TOP_BAR_ACTIONS.length,
    );
    expect(consoleError).not.toHaveBeenCalled();

    consoleError.mockRestore();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("moves the focused control with nav.left and nav.right", async () => {
    const setup = await renderTopBar();

    await waitForBranch(setup);
    await focusTopBar(setup);

    expect(setup.captureCharFrame()).toContain(`${ICONS.focus} main`);
    expectButtonFocused(setup.captureSpans(), ICONS.pull, false);

    await pressKey(setup, "right");
    expect(setup.captureCharFrame()).not.toContain(`${ICONS.focus} main`);
    expectButtonFocused(setup.captureSpans(), ICONS.pull, true);
    expectButtonFocused(setup.captureSpans(), ICONS.push, false);

    await pressKey(setup, "right");
    expectButtonFocused(setup.captureSpans(), ICONS.push, true);

    await pressKey(setup, "right");
    expectButtonFocused(setup.captureSpans(), ICONS.ellipsis, true);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("clamps the focused index when the control list shrinks", async () => {
    const setup = await renderTopBar();

    await waitForBranch(setup);
    await focusTopBar(setup);

    await pressKey(setup, "right");
    await pressKey(setup, "right");
    await pressKey(setup, "right");

    expectButtonFocused(setup.captureSpans(), ICONS.ellipsis, true);

    await act(async () => {
      latestStatus?.beginOperation("Fetch");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    await pressKey(setup, "left");

    expectButtonFocused(setup.captureSpans(), ICONS.push, true);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the focused control across the idle info stop disappearing and returning", async () => {
    const setup = await renderTopBar();

    await waitForBranch(setup);
    await focusTopBar(setup);
    await pressKey(setup, "right");

    expectButtonFocused(setup.captureSpans(), ICONS.pull, true);

    await act(async () => {
      latestStatus?.beginOperation("Fetch");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expectButtonFocused(setup.captureSpans(), ICONS.pull, true);
    expectButtonFocused(setup.captureSpans(), ICONS.push, false);

    await act(async () => {
      latestStatus?.endOperation();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expectButtonFocused(setup.captureSpans(), ICONS.pull, true);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("does not activate a hidden info stop from Enter", async () => {
    const setup = await renderTopBar();

    await waitForBranch(setup);
    await focusTopBar(setup);

    expect(setup.captureCharFrame()).toContain(`${ICONS.focus} main`);

    await act(async () => {
      latestStatus?.beginOperation("Fetch");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    await pressKey(setup, "enter");

    const frame = setup.captureSpans();

    expectButtonFocused(frame, ICONS.pull, false);
    expectButtonFocused(frame, ICONS.push, false);

    await act(async () => {
      latestStatus?.endOperation();
    });
    await act(async () => {
      await setup.dispose();
    });
  });

  it("opens the More menu with the more action and toggles it closed", async () => {
    const setup = await renderTopBar();

    await waitForBranch(setup);
    await focusTopBar(setup);

    await pressKey(setup, "more");

    expect(latestOverlay?.entry?.kind).toBe("modal");
    expect(latestOverlay?.entry?.id).toBe("remote.more");
    expect(latestOverlay?.toggleActionId).toBe("remote.more");

    await pressKey(setup, "more");

    expect(latestOverlay?.entry).toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows the branch control focus marker only while the info control is focused", async () => {
    const setup = await renderTopBar();

    await waitForBranch(setup);
    await focusTopBar(setup);

    expect(setup.captureCharFrame()).toContain(`${ICONS.focus} main`);

    await pressKey(setup, "right");

    expect(setup.captureCharFrame()).not.toContain(`${ICONS.focus} main`);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("routes the p, P, and F keybindings to the remote commands with explicit targets", async () => {
    const calls: { commandId: string; target: CommandTarget }[] = [];
    const register = (commandId: string): (() => void) =>
      registerCommandHandler({
        commandId,
        operationLabel: commandId,
        handler: async (context) => {
          calls.push({ commandId, target: context.target });

          return { steps: [] };
        },
      });
    const cleanups = [
      register("remote.pull"),
      register("remote.push"),
      register("remote.fetchPrune"),
    ];
    const setup = await renderTopBar();

    await waitForBranch(setup);
    await focusTopBar(setup);

    const expectedCounts = [1, 2, 3];

    for (const [index, key] of ["p", "P", "F"].entries()) {
      await act(async () => {
        setup.mockInput.pressKey(key);
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      const deadline = Date.now() + 2_000;

      while (
        (calls.length < (expectedCounts[index] ?? 0) || isCommandOrchestrationActive()) &&
        Date.now() < deadline
      ) {
        await act(async () => {
          await setup.renderOnce();
          await new Promise((resolve) => setTimeout(resolve, 10));
        });
      }
    }

    expect(calls).toEqual([
      { commandId: "remote.pull", target: { kind: "branch", name: "main" } },
      { commandId: "remote.push", target: { kind: "branch", name: "main" } },
      { commandId: "remote.fetchPrune", target: { kind: "none" } },
    ]);

    for (const cleanup of cleanups) {
      cleanup();
    }

    await act(async () => {
      await setup.dispose();
    });
  });
});
