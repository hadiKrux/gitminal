import { beforeEach, describe, expect, it } from "bun:test";
import type { ScrollBoxRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { resetInputModes } from "@/app/hooks/inputMode.registry";
import {
  hasRegisteredAction,
  resetActionRegistry,
  resolveActionHandler,
} from "@/app/hooks/useAction";
import { readActionAvailability, resetActionAvailability } from "@/app/hooks/useActionAvailability";
import { useHotkeys } from "@/app/hooks/useHotkeys";
import { clearFocusedInput, resetInputEscapeClear } from "@/app/hooks/useInputEscapeClear";
import { useRepository } from "@/app/hooks/useRepository";
import { useStatus } from "@/app/hooks/useStatus";
import { DEFAULT_CONFIG } from "@/domain/config/config.defaults";
import type { GitminalConfig } from "@/domain/config/config.types";
import { buildListLocalBranchesArgs } from "@/domain/git/git.branches";
import { buildListRemoteBranchesArgs } from "@/domain/git/git.remote-branches";
import type { GitClient, GitInvocationResult } from "@/domain/git/git.types";
import type { EnsureLoadedResult } from "@/domain/graph/graph.types";
import { CommitGraph } from "@/features/graph/CommitGraph";
import {
  GRAPH_CONTENT_PADDING_X,
  GRAPH_PENDING_ROW_ID,
  GRAPH_LOAD_ERROR_MESSAGE,
  GRAPH_RETRY_ID,
  GRAPH_LOAD_OLDER_ID,
  GRAPH_ROW_HEIGHT,
  GRAPH_SCROLL_ID,
  GRAPH_SEARCH_INPUT_ID,
  GRAPH_WALK_ERROR_MESSAGE,
  GRAPH_WALK_RETRY_ID,
} from "@/features/graph/graph.constants";
import { graphRowRenderableId, searchResultRowId } from "@/features/graph/graph.rows";
import { AppTestProviders } from "@/test/app.harness";
import { createFakeGitClient, fakeGitResult } from "@/test/git.fake";
import { ICONS } from "@/theme/icons";

/** NUL field separator of the log fixture. */
const NUL = "\x00";

/** Record separator of the log fixture. */
const RS = "\x1e";

/** Captured repository context. */
let latest: ReturnType<typeof useRepository> | undefined;

/** Captured status context. */
let latestStatus: ReturnType<typeof useStatus> | undefined;

/** Branch date used by the mutable tip snapshot. */
const TIP_BRANCH_DATE = "2026-01-02T03:04:05+00:00";

/** Handler that answers the next graph or search log invocation. */
type LogHandler = (options: { readonly args: readonly string[] }) => Promise<GitInvocationResult>;

/** Fake graph client plus its counters and mutable log handler. */
interface FakeGraphClient {
  readonly client: GitClient;
  readonly counts: Map<string, number>;
  setLogHandler(handler: LogHandler): void;
}

/**
 * Builds one version-1 log record with a single modified file.
 *
 * @param input - OID, subject, parents, body, and decorations.
 * @returns The record bytes.
 */
function record(input: {
  readonly oid: string;
  readonly subject: string;
  readonly parents?: readonly string[];
  readonly body?: string;
  readonly decorations?: readonly string[];
  readonly author?: string;
  readonly timestamp?: number;
  readonly fileCount?: number;
}): string {
  const files = Array.from({ length: input.fileCount ?? 1 }, (_, index) => {
    const path = `${input.oid}-${index}.txt`;

    return {
      raw: `:100644 100644 aaaaaaa bbbbbbb M${NUL}${path}${NUL}`,
      numstat: `1\t0\t${path}${NUL}`,
    };
  });
  const fields = [
    input.oid,
    (input.parents ?? []).join(" "),
    input.author ?? "Alice Ng",
    "alice@example.com",
    "2026-10-25T09:30:00+00:00",
    String(input.timestamp ?? 1_792_985_400),
    (input.decorations ?? []).join(", "),
    input.subject,
    input.body ?? "",
  ].join(NUL);

  return `${RS}1${NUL}${fields}${RS}${NUL}\n${files.map((file) => file.raw).join("")}${files.map((file) => file.numstat).join("")}`;
}

/**
 * Builds a page of records with sequential OIDs.
 *
 * @param count - Number of records.
 * @param prefix - Subject prefix.
 * @returns The concatenated records and their OIDs.
 */
function page(
  count: number,
  prefix: string,
  fileCount: number = 1,
): { readonly output: string; readonly oids: string[] } {
  const oids: string[] = [];
  const outputs: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const oid = graphOid(prefix, index);

    oids.push(oid);
    outputs.push(
      record({
        oid,
        subject: `${prefix} commit ${index}`,
        parents: [graphOid(prefix, index + 1)],
        decorations: index === 0 ? ["refs/heads/main"] : [],
        fileCount,
      }),
    );
  }

  return { output: outputs.join(""), oids };
}

/**
 * Builds one unique fixture OID.
 *
 * @param prefix - Subject prefix.
 * @param index - Row index.
 * @returns The OID.
 */
function graphOid(prefix: string, index: number): string {
  return `${prefix}${String(index).padStart(4, "0")}`;
}

/**
 * Creates a fake client that answers graph log calls with a scripted handler and delegates the
 * repository reads to the shared fake.
 *
 * @param handler - Initial log handler.
 * @returns The fake client, counters, and handler setter.
 */
function createGraphClient(handler: LogHandler): FakeGraphClient {
  const base = createFakeGitClient();
  const counts = new Map<string, number>();
  let logHandler = handler;
  const client: GitClient = {
    gitPath: "git",
    invoke: async (options) => {
      const key = options.args.join(" ");

      counts.set(key, (counts.get(key) ?? 0) + 1);

      if (options.args[0] === "log" && options.args.includes("--raw")) {
        return await logHandler({ args: options.args });
      }

      return await base.client.invoke(options);
    },
  };

  return {
    client,
    counts,
    setLogHandler(next: LogHandler): void {
      logHandler = next;
    },
  };
}

/**
 * Overrides the status and branch reads so a test can move the scope tip.
 *
 * The log handler and every other answer still come from the shared graph fake, so the only changed
 * input between the initial read and the watcher-style refresh is the branch tip and HEAD.
 *
 * @param fake - Graph fake whose log handler answers history reads.
 * @param snapshot - Mutable tip OID the test updates before a refresh.
 * @returns A client that answers the current snapshot.
 */
function createSnapshotClient(fake: FakeGraphClient, snapshot: { tipOid: string }): GitClient {
  const branchKey = buildListLocalBranchesArgs().join(" ");
  const remoteKey = buildListRemoteBranchesArgs().join(" ");

  return {
    gitPath: "git",
    invoke: async (options) => {
      const key = options.args.join(" ");

      if (key === "status --porcelain=v2 --branch -z --untracked-files=all") {
        return fakeGitResult([`# branch.oid ${snapshot.tipOid}`, "# branch.head main"].join(NUL));
      }

      if (key === branchKey) {
        return fakeGitResult(
          `main${NUL}${snapshot.tipOid}${NUL}*${NUL}${TIP_BRANCH_DATE}${NUL}${NUL}${NUL}`,
        );
      }

      if (key === remoteKey) {
        return fakeGitResult("");
      }

      return await fake.client.invoke(options);
    },
  };
}

/**
 * Builds the fake log output for one slice of a linear commit order.
 *
 * @param order - Newest-first OIDs the fake history walks.
 * @param subjects - Subject per OID.
 * @param start - First order index in the page.
 * @param count - Maximum rows to emit.
 * @param tipOid - OID that carries the local branch decoration.
 * @returns Concatenated records.
 */
function orderedRecordPage(
  order: readonly string[],
  subjects: Readonly<Record<string, string>>,
  start: number,
  count: number,
  tipOid: string,
): string {
  return order
    .slice(start, start + count)
    .map((oid, offset) => {
      const parent = order[start + offset + 1];

      return record({
        oid,
        subject: subjects[oid] ?? oid,
        parents: parent === undefined ? [] : [parent],
        decorations: oid === tipOid ? ["refs/heads/main"] : [],
      });
    })
    .join("");
}

/**
 * Builds the test configuration.
 *
 * @param pageSize - Initial and per-page commit count.
 * @returns The effective config.
 */
function configWithPageSize(pageSize: number): GitminalConfig {
  return {
    ...DEFAULT_CONFIG,
    graph: { ...DEFAULT_CONFIG.graph, initialPageSize: pageSize },
  };
}

/** Mounts the graph with the keyboard dispatcher. */
function GraphHost(): ReactNode {
  useHotkeys();

  return <CommitGraph />;
}

/** Mounts the graph inside a panel narrower than the terminal. */
function NarrowGraphHost(): ReactNode {
  useHotkeys();

  return (
    <box flexDirection="column" width={40} height={20}>
      <CommitGraph />
    </box>
  );
}

/** Mounts the graph in an explicit panel slot while the terminal keeps its real size. */
function SlotGraphHost(props: { readonly width: number; readonly height: number }): ReactNode {
  useHotkeys();

  return (
    <box flexDirection="column" width={props.width} height={props.height}>
      <CommitGraph />
    </box>
  );
}

/** Captures the repository context for assertions. */
function RepositoryProbe(): ReactNode {
  latest = useRepository();

  return <text id="graph-selection">{latest.selection.kind}</text>;
}

/** Captures the status context for assertions. */
function StatusProbe(): ReactNode {
  latestStatus = useStatus();

  return null;
}

/**
 * Renders the graph inside the app providers.
 *
 * @param fake - Fake client.
 * @param pageSize - Graph page size.
 * @param size - Terminal size.
 * @param host - Graph host mounted inside the terminal. Defaults to the full-height graph.
 * @returns The renderer setup.
 */
async function renderGraph(
  fake: FakeGraphClient,
  pageSize: number = 10,
  size: { readonly width?: number; readonly height?: number } = {},
  host: ReactNode = <GraphHost />,
): Promise<Awaited<ReturnType<typeof testRender>>> {
  latest = undefined;

  const setup = await testRender(
    <AppTestProviders gitClient={fake.client} config={configWithPageSize(pageSize)}>
      {host}
      <RepositoryProbe />
      <StatusProbe />
    </AppTestProviders>,
    { width: size.width ?? 70, height: size.height ?? 24 },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

beforeEach(() => {
  resetActionAvailability();
  resetActionRegistry();
  resetInputModes();
  resetInputEscapeClear();
  latest = undefined;
  latestStatus = undefined;
});

/** One log read recorded by the coexisting-failure fixture. */
type CoexistingRead = "scope" | "continuation";

/** Coexisting walk and page failure fixture. */
interface CoexistingFailureFixture {
  readonly setup: Awaited<ReturnType<typeof testRender>>;
  readonly reads: { readonly log: CoexistingRead[] };
  setFailContinuation(value: boolean): void;
}

/**
 * Renders a graph whose window reload loses the selection to a failed walk and, optionally, whose
 * next older-page read then fails.
 *
 * No scope tip changes, so the automatic tips reload never runs. A manual graph-window reload
 * re-reads the window from an external-tip fixture that excludes the selected history commit, so its
 * restoration walk fails and records the retryable walk notice. In the older-page variant the
 * provider selection is moved directly to the newest loaded row, which no cursor dispatch overwrites,
 * so moving the cursor to the last row preserves the walk notice while the explicit graph load action
 * requests the older page that fails. A page failure then takes over the error surface.
 *
 * @param input - Terminal size, graph-slot size, and whether to fail the next older page.
 * @returns The renderer setup, the ordered read log, and the continuation failure switch.
 */
async function renderCoexistingFailures(input: {
  readonly width: number;
  readonly height: number;
  readonly failOlderPage: boolean;
}): Promise<CoexistingFailureFixture> {
  const external = Array.from({ length: 10 }, (_, index) => `ext${String(index).padStart(4, "0")}`);
  const history = Array.from({ length: 20 }, (_, index) => `hist${String(index).padStart(4, "0")}`);
  const order = [...external, ...history];
  const subjects: Readonly<Record<string, string>> = Object.fromEntries([
    ...external.map((oid, index) => [oid, `external commit ${index}`]),
    ...history.map((oid, index) => [oid, `hist commit ${index}`]),
  ]);
  const reads: { log: CoexistingRead[] } = { log: [] };
  let failContinuation = false;
  let phase: "history" | "external" = "history";
  const fake = createGraphClient(async ({ args }) => {
    const formatIndex = args.findIndex((arg) => arg.startsWith("--format="));
    const hasScope = args.includes("--branches");
    const frontier = hasScope ? [] : args.slice(formatIndex + 1);

    reads.log.push(hasScope ? "scope" : "continuation");

    if (failContinuation && !hasScope) {
      return fakeGitResult("", false, "fatal: unable to read history");
    }

    const start = hasScope
      ? order.indexOf(phase === "history" ? "hist0000" : "ext0000")
      : Math.min(...frontier.map((oid) => order.indexOf(oid)).filter((index) => index >= 0));

    return fakeGitResult(
      orderedRecordPage(order, subjects, start < 0 ? order.length : start, 10, "hist0000"),
    );
  });
  const setup = await renderGraph(
    fake,
    10,
    { width: input.width, height: input.height },
    <SlotGraphHost width={20} height={20} />,
  );

  await waitFor(setup, () => setup.captureCharFrame().includes("hist commit 3"));

  await act(async () => {
    await latest?.selectCommit("hist0003");
    await setup.renderOnce();
  });

  phase = "external";
  failContinuation = true;

  await act(async () => {
    await latest?.refreshGraphWindow();
    await setup.renderOnce();
  });
  await waitFor(
    setup,
    () => setup.renderer.root.findDescendantById(GRAPH_WALK_RETRY_ID) !== undefined,
  );

  if (input.failOlderPage) {
    await act(async () => {
      latest?.setSelection({ kind: "commit", oid: external[9] as string });
      await setup.renderOnce();
    });
    await act(async () => {
      resolveActionHandler("nav.last", "graph")?.();
      await setup.renderOnce();
    });
    await act(async () => {
      resolveActionHandler("graph.loadOlder", "graph")?.();
      await setup.renderOnce();
    });
    await waitFor(
      setup,
      () => setup.renderer.root.findDescendantById(GRAPH_RETRY_ID) !== undefined,
    );
  }

  return {
    setup,
    reads,
    setFailContinuation(value: boolean): void {
      failContinuation = value;
    },
  };
}

/**
 * Waits until a predicate is true or the deadline passes.
 *
 * @param setup - Renderer setup.
 * @param predicate - Condition to poll.
 * @param timeoutMs - Maximum wait.
 */
async function waitFor(
  setup: Awaited<ReturnType<typeof testRender>>,
  predicate: () => boolean,
  timeoutMs: number = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!predicate() && Date.now() < deadline) {
    await act(async () => {
      await setup.renderOnce();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

/**
 * Simulates one left mouse click on a renderable.
 *
 * @param setup - Renderer setup.
 * @param id - Renderable id of the target.
 */
async function click(setup: Awaited<ReturnType<typeof testRender>>, id: string): Promise<void> {
  const target = setup.renderer.root.findDescendantById(id);

  if (target === undefined) {
    throw new Error(`renderable ${id} is missing`);
  }

  const { MouseEvent } = await import("@opentui/core");

  target.processMouseEvent(
    new MouseEvent(target, {
      type: "down",
      button: 0,
      x: 1,
      y: 0,
      modifiers: { shift: false, alt: false, ctrl: false },
    }),
  );
}

/**
 * Counts non-overlapping occurrences of one text in a frame.
 *
 * @param frame - Rendered frame.
 * @param text - Text to count.
 * @returns Number of occurrences.
 */
function readOccurrences(frame: string, text: string): number {
  return frame.split(text).length - 1;
}

/**
 * Reports whether one graph row is fully inside the graph scrollbox viewport.
 *
 * @param setup - Renderer setup.
 * @param rowId - Renderable id of the row.
 * @returns True when the row is mounted and both of its lines are inside the viewport.
 */
function isRowInsideViewport(
  setup: Awaited<ReturnType<typeof testRender>>,
  rowId: string,
): boolean {
  const scrollbox = setup.renderer.root.findDescendantById(GRAPH_SCROLL_ID) as
    | ScrollBoxRenderable
    | undefined;
  const row = setup.renderer.root.findDescendantById(rowId);

  if (scrollbox === undefined || row === undefined) {
    return false;
  }

  return (
    row.y >= scrollbox.viewport.y &&
    row.y + row.height <= scrollbox.viewport.y + scrollbox.viewport.height
  );
}

describe("CommitGraph", () => {
  it("renders loaded rows and the pending row", async () => {
    const fake = createGraphClient(async () => fakeGitResult(page(2, "row").output));
    const setup = await renderGraph(fake);

    await waitFor(setup, () => setup.captureCharFrame().includes("row commit 1"));

    const frame = setup.captureCharFrame();

    expect(frame).toContain("Commits");
    expect(frame).toContain("Commit Changes");
    expect(frame).toContain("row commit 0");
    expect(frame).toContain("row commit 1");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("starts each row's text right after its own lane grid", async () => {
    const output = [
      record({
        oid: "aaaaaaaa01",
        subject: "Merge top",
        parents: ["aaaaaaaa02", "aaaaaaaa03"],
      }),
      record({ oid: "aaaaaaaa03", subject: "Branch work", parents: ["aaaaaaaa04"] }),
      record({ oid: "aaaaaaaa02", subject: "Main work", parents: ["aaaaaaaa04"] }),
      record({ oid: "aaaaaaaa04", subject: "Base work", parents: ["aaaaaaaa05"] }),
      record({ oid: "aaaaaaaa05", subject: "Root work", parents: [] }),
    ].join("");
    const fake = createGraphClient(async () => fakeGitResult(output));
    const setup = await renderGraph(fake);

    await waitFor(setup, () => setup.captureCharFrame().includes("Root work"));

    const lines = setup.captureCharFrame().split("\n");
    const mergeIndex = lines.findIndex((line) => line.includes("Merge top"));
    const mergeLine = lines[mergeIndex] ?? "";
    const metadataLine = lines[mergeIndex + 1] ?? "";
    const rootLine = lines.find((line) => line.includes("Root work")) ?? "";
    const rootMetadataLine =
      lines[(lines.findIndex((line) => line.includes("Root work")) ?? 0) + 1] ?? "";
    const pendingLine = lines.find((line) => line.includes("Commit Changes")) ?? "";
    const mergeSubject = mergeLine.indexOf("Merge top");
    const rootSubject = rootLine.indexOf("Root work");

    expect(mergeSubject).toBeGreaterThan(-1);
    expect(mergeSubject).toBe(mergeLine.indexOf(ICONS.graphMerge) + 4);
    expect(metadataLine.indexOf("Alice Ng")).toBe(mergeSubject);
    expect(rootSubject).toBe(rootLine.indexOf(ICONS.graphCommit) + 2);
    expect(rootMetadataLine.indexOf("Alice Ng")).toBe(rootSubject);
    expect(pendingLine.indexOf("Commit Changes")).toBe(rootSubject);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("pads the row body on both sides inside the scrollbox", async () => {
    const rows = page(2, "pad");
    const fake = createGraphClient(async () => fakeGitResult(rows.output));
    const setup = await renderGraph(fake);

    await waitFor(setup, () => setup.captureCharFrame().includes("pad commit 0"));

    const scrollbox = setup.renderer.root.findDescendantById(
      GRAPH_SCROLL_ID,
    ) as ScrollBoxRenderable;
    const row = setup.renderer.root.findDescendantById(graphRowRenderableId(rows.oids[0] ?? ""));

    expect(row?.x).toBe(scrollbox.x + GRAPH_CONTENT_PADDING_X);
    expect(row?.width).toBe(scrollbox.viewport.width - GRAPH_CONTENT_PADDING_X * 2);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("mounts every loaded row and sizes the scrollbar from the loaded rows", async () => {
    const rows = page(30, "wide");
    const fake = createGraphClient(async () => fakeGitResult(rows.output));
    const setup = await renderGraph(fake, 40, { height: 12 });

    await waitFor(setup, () => setup.captureCharFrame().includes("wide commit 0"));

    const scrollbox = setup.renderer.root.findDescendantById(
      GRAPH_SCROLL_ID,
    ) as ScrollBoxRenderable;
    const contentHeight = (rows.oids.length + 1) * GRAPH_ROW_HEIGHT;

    for (const oid of rows.oids) {
      expect(setup.renderer.root.findDescendantById(graphRowRenderableId(oid))).toBeDefined();
    }

    expect(
      setup.renderer.root.findDescendantById(graphRowRenderableId(GRAPH_PENDING_ROW_ID)),
    ).toBeDefined();
    await waitFor(setup, () => scrollbox.scrollHeight === contentHeight);

    expect(scrollbox.scrollHeight).toBe(contentHeight);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the selected row inside the viewport on keyboard navigation", async () => {
    const rows = page(30, "keyboard");
    const fake = createGraphClient(async () => fakeGitResult(rows.output));
    const setup = await renderGraph(fake, 40, { height: 14 });

    await waitFor(setup, () => setup.captureCharFrame().includes("keyboard commit 0"));

    const scrollbox = setup.renderer.root.findDescendantById(
      GRAPH_SCROLL_ID,
    ) as ScrollBoxRenderable;

    expect(scrollbox.scrollTop).toBe(0);

    await act(async () => {
      resolveActionHandler("nav.last", "graph")?.();
      await setup.renderOnce();
    });
    await waitFor(
      setup,
      () =>
        latest?.selection.kind === "commit" && latest.selection.oid === (rows.oids[29] as string),
    );
    await waitFor(setup, () =>
      isRowInsideViewport(setup, graphRowRenderableId(rows.oids[29] ?? "")),
    );

    const row = setup.renderer.root.findDescendantById(graphRowRenderableId(rows.oids[29] ?? ""));

    expect(scrollbox.scrollTop).toBe(scrollbox.scrollHeight - scrollbox.viewport.height);
    expect(row?.y).toBeGreaterThanOrEqual(scrollbox.viewport.y);
    expect((row?.y ?? 0) + (row?.height ?? 0)).toBeLessThanOrEqual(
      scrollbox.viewport.y + scrollbox.viewport.height,
    );

    await act(async () => {
      await setup.dispose();
    });
  });

  it("scrolls the viewport on the wheel without moving the selection", async () => {
    const rows = page(30, "wheelstep");
    const fake = createGraphClient(async () => fakeGitResult(rows.output));
    const setup = await renderGraph(fake, 40, { height: 14 });

    await waitFor(setup, () => setup.captureCharFrame().includes("wheelstep commit 0"));

    const scrollbox = setup.renderer.root.findDescendantById(
      GRAPH_SCROLL_ID,
    ) as ScrollBoxRenderable;
    const selectionBefore = latest?.selection;

    for (let step = 0; step < 4; step += 1) {
      await act(async () => {
        await setup.mockMouse.scroll(20, 8, "down");
      });
      await act(async () => {
        await setup.renderOnce();
      });
    }

    await waitFor(setup, () => scrollbox.scrollTop > 0);

    expect(scrollbox.scrollTop).toBeGreaterThan(0);
    expect(latest?.selection).toEqual(selectionBefore);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("re-anchors the cursor to the visible rows after a native scroll", async () => {
    const rows = page(30, "anchor");
    const fake = createGraphClient(async () => fakeGitResult(rows.output));
    const setup = await renderGraph(fake, 40, { height: 14 });

    await waitFor(setup, () => setup.captureCharFrame().includes("anchor commit 0"));

    const scrollbox = setup.renderer.root.findDescendantById(
      GRAPH_SCROLL_ID,
    ) as ScrollBoxRenderable;

    for (let step = 0; step < 6; step += 1) {
      await act(async () => {
        await setup.mockMouse.scroll(20, 8, "down");
      });
      await act(async () => {
        await setup.renderOnce();
      });
    }

    await waitFor(setup, () => scrollbox.scrollTop > 0);

    const scrolledTop = scrollbox.scrollTop;
    const firstVisible = Math.floor(scrolledTop / GRAPH_ROW_HEIGHT);
    const anchorOid = rows.oids[firstVisible - 1] as string;

    await act(async () => {
      resolveActionHandler("nav.down", "graph")?.();
      await setup.renderOnce();
    });

    await waitFor(
      setup,
      () => latest?.selection.kind === "commit" && latest.selection.oid === anchorOid,
    );

    expect(latest?.selection).toEqual({ kind: "commit", oid: anchorOid });
    expect(Math.abs(scrollbox.scrollTop - scrolledTop)).toBeLessThanOrEqual(GRAPH_ROW_HEIGHT);
    await waitFor(setup, () => isRowInsideViewport(setup, graphRowRenderableId(anchorOid)));

    await act(async () => {
      resolveActionHandler("nav.down", "graph")?.();
      await setup.renderOnce();
    });

    await waitFor(
      setup,
      () =>
        latest?.selection.kind === "commit" &&
        latest.selection.oid === (rows.oids[firstVisible] as string),
    );

    expect(latest?.selection).toEqual({
      kind: "commit",
      oid: rows.oids[firstVisible] as string,
    });
    expect(Math.abs(scrollbox.scrollTop - scrolledTop)).toBeLessThanOrEqual(GRAPH_ROW_HEIGHT);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("anchors an up move to the nearest visible edge after a native scroll", async () => {
    const rows = page(30, "anchorup");
    const fake = createGraphClient(async () => fakeGitResult(rows.output));
    const setup = await renderGraph(fake, 40, { height: 14 });

    await waitFor(setup, () => setup.captureCharFrame().includes("anchorup commit 0"));

    const scrollbox = setup.renderer.root.findDescendantById(
      GRAPH_SCROLL_ID,
    ) as ScrollBoxRenderable;

    for (let step = 0; step < 6; step += 1) {
      await act(async () => {
        await setup.mockMouse.scroll(20, 8, "down");
      });
      await act(async () => {
        await setup.renderOnce();
      });
    }

    await waitFor(setup, () => scrollbox.scrollTop > 0);

    const scrolledTop = scrollbox.scrollTop;
    const firstVisible = Math.floor(scrolledTop / GRAPH_ROW_HEIGHT);
    const anchorOid = rows.oids[firstVisible - 1] as string;

    await act(async () => {
      resolveActionHandler("nav.up", "graph")?.();
      await setup.renderOnce();
    });

    await waitFor(
      setup,
      () => latest?.selection.kind === "commit" && latest.selection.oid === anchorOid,
    );

    expect(latest?.selection).toEqual({ kind: "commit", oid: anchorOid });
    expect(Math.abs(scrollbox.scrollTop - scrolledTop)).toBeLessThanOrEqual(GRAPH_ROW_HEIGHT);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("truncates the load control label in the narrow graph slot", async () => {
    const rows = page(2, "narrowload");
    const fake = createGraphClient(async () => fakeGitResult(rows.output));
    const setup = await renderGraph(
      fake,
      2,
      { width: 80, height: 24 },
      <SlotGraphHost width={20} height={20} />,
    );

    await waitFor(setup, () => setup.captureCharFrame().includes("Load older"));

    const scrollbox = setup.renderer.root.findDescendantById(
      GRAPH_SCROLL_ID,
    ) as ScrollBoxRenderable;
    const button = setup.renderer.root.findDescendantById(GRAPH_LOAD_OLDER_ID);
    const line =
      setup
        .captureCharFrame()
        .split("\n")
        .find((row) => row.includes("Load older")) ?? "";

    expect(line).toContain("...");
    expect(button?.width ?? 0).toBeLessThanOrEqual(scrollbox.viewport.width);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the last selected row and the page error visible at 80x24", async () => {
    const rows = page(30, "tall");
    let fail = false;
    const fake = createGraphClient(async () =>
      fail ? fakeGitResult("", false, "fatal: unable to read history") : fakeGitResult(rows.output),
    );
    const setup = await renderGraph(fake, 40, { width: 80, height: 24 });

    await waitFor(setup, () => setup.captureCharFrame().includes("tall commit 0"));

    await act(async () => {
      resolveActionHandler("nav.last", "graph")?.();
      await setup.renderOnce();
    });
    await waitFor(setup, () => setup.captureCharFrame().includes("tall commit 29"));

    fail = true;

    await act(async () => {
      await latest?.refreshGraphWindow();
      await setup.renderOnce();
    });
    await waitFor(setup, () => setup.captureCharFrame().includes(GRAPH_LOAD_ERROR_MESSAGE));

    // One more frame lets the measured viewport pick up the taller footer and the height reveal.
    await act(async () => {
      await setup.renderOnce();
    });
    await waitFor(setup, () => setup.captureCharFrame().includes("tall commit 29"));

    const frame = setup.captureCharFrame();

    expect(frame).toContain("tall commit 29");
    expect(frame).toContain(GRAPH_LOAD_ERROR_MESSAGE);
    expect(frame).toContain("fatal: unable to read history");
    expect(frame).toContain("Retry");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the last selected row visible in the 20x20 graph slot of an 80x24 shell", async () => {
    const rows = page(30, "s");
    const fake = createGraphClient(async () => fakeGitResult(rows.output));
    const setup = await renderGraph(
      fake,
      40,
      { width: 80, height: 24 },
      <SlotGraphHost width={20} height={20} />,
    );

    await waitFor(setup, () => setup.captureCharFrame().includes("s commit 0"));

    await act(async () => {
      resolveActionHandler("nav.last", "graph")?.();
      await setup.renderOnce();
    });
    await waitFor(setup, () =>
      isRowInsideViewport(setup, graphRowRenderableId(rows.oids[29] ?? "")),
    );

    expect(isRowInsideViewport(setup, graphRowRenderableId(rows.oids[29] ?? ""))).toBe(true);
    expect(
      setup.renderer.root.findDescendantById(graphRowRenderableId(rows.oids[29] ?? "")),
    ).toBeDefined();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("moves PageDown by the measured viewport rows in the 20x20 graph slot", async () => {
    const rows = page(30, "p");
    const fake = createGraphClient(async () => fakeGitResult(rows.output));
    const setup = await renderGraph(
      fake,
      40,
      { width: 80, height: 24 },
      <SlotGraphHost width={20} height={20} />,
    );

    await waitFor(setup, () => setup.captureCharFrame().includes("p commit 0"));

    const scrollbox = setup.renderer.root.findDescendantById(
      GRAPH_SCROLL_ID,
    ) as ScrollBoxRenderable;
    const capacity = Math.max(1, Math.floor(scrollbox.viewport.height / GRAPH_ROW_HEIGHT));

    await act(async () => {
      resolveActionHandler("nav.down", "graph")?.();
      await setup.renderOnce();
    });
    await act(async () => {
      resolveActionHandler("nav.pageDown", "graph")?.();
      await setup.renderOnce();
    });
    await waitFor(
      setup,
      () =>
        latest?.selection.kind === "commit" &&
        latest.selection.oid === (rows.oids[capacity] as string),
    );

    expect(latest?.selection).toEqual({ kind: "commit", oid: rows.oids[capacity] as string });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the page Retry and the walk notice in the narrow graph frame", async () => {
    const rows = page(3, "n");
    let fail = false;
    const fake = createGraphClient(async () =>
      fail
        ? fakeGitResult(
            "",
            false,
            "fatal: unable to read history because the object store is corrupt",
          )
        : fakeGitResult(rows.output),
    );
    const setup = await renderGraph(
      fake,
      40,
      { width: 20, height: 24 },
      <SlotGraphHost width={20} height={20} />,
    );

    await waitFor(setup, () => setup.captureCharFrame().includes("n commit 2"));

    fail = true;

    await act(async () => {
      await latest?.refreshGraphWindow();
      await setup.renderOnce();
    });
    await waitFor(setup, () => setup.captureCharFrame().includes("fatal: unable"));

    await act(async () => {
      await latest?.selectCommit("missing-walk");
      await setup.renderOnce();
    });
    await waitFor(setup, () => setup.captureCharFrame().includes("Unable to l"));

    // One more frame lets the measured viewport pick up the new footer height.
    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();

    expect(frame).toContain("Retry");
    expect(frame).toContain("n commit 2");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("re-runs the window reload from the walk Retry", async () => {
    const fixture = await renderCoexistingFailures({
      width: 30,
      height: 24,
      failOlderPage: false,
    });

    fixture.setFailContinuation(false);

    const start = fixture.reads.log.length;

    await act(async () => {
      await click(fixture.setup, GRAPH_WALK_RETRY_ID);
      await fixture.setup.renderOnce();
    });
    await waitFor(fixture.setup, () => fixture.reads.log.length > start);

    expect(fixture.reads.log[start]).toBe("scope");

    await act(async () => {
      await fixture.setup.dispose();
    });
  });

  it("lets a page failure take over the walk notice and pages from the page Retry", async () => {
    const fixture = await renderCoexistingFailures({
      width: 30,
      height: 24,
      failOlderPage: true,
    });

    expect(fixture.setup.renderer.root.findDescendantById(GRAPH_WALK_RETRY_ID)).toBeUndefined();
    expect(fixture.setup.renderer.root.findDescendantById(GRAPH_RETRY_ID)).toBeDefined();
    expect(fixture.setup.captureCharFrame()).not.toContain(GRAPH_WALK_ERROR_MESSAGE);

    fixture.setFailContinuation(false);

    const start = fixture.reads.log.length;

    await act(async () => {
      await click(fixture.setup, GRAPH_RETRY_ID);
      await fixture.setup.renderOnce();
    });
    await waitFor(fixture.setup, () => fixture.reads.log.length > start);

    expect(fixture.reads.log[start]).toBe("continuation");

    await act(async () => {
      await fixture.setup.dispose();
    });
  });

  it("shows the initial loading row and keeps the pending row visible", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fake = createGraphClient(async () => {
      await gate;

      return fakeGitResult(page(2, "slow").output);
    });
    const setup = await renderGraph(fake);

    await waitFor(setup, () => setup.captureCharFrame().includes("Loading history..."));

    const frame = setup.captureCharFrame();

    expect(frame).toContain("Loading history...");
    expect(frame).toContain("Commit Changes");

    await act(async () => {
      release();
      await setup.renderOnce();
    });

    await waitFor(setup, () => setup.captureCharFrame().includes("slow commit 0"));

    await act(async () => {
      await setup.dispose();
    });
  });

  it("loads an older page from the explicit action and hides the load control", async () => {
    const first = page(10, "old");
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fake = createGraphClient(async ({ args }) => {
      if (args.includes("--branches")) {
        return fakeGitResult(first.output);
      }

      await gate;

      return fakeGitResult("");
    });
    const setup = await renderGraph(fake, 10, { height: 40 });

    await waitFor(setup, () => setup.captureCharFrame().includes("old commit 9"));
    expect(setup.renderer.root.findDescendantById(GRAPH_LOAD_OLDER_ID)).toBeDefined();
    expect(setup.captureCharFrame()).toContain("10+ commits");

    await act(async () => {
      resolveActionHandler("graph.loadOlder", "graph")?.();
      await setup.renderOnce();
    });

    await waitFor(setup, () => setup.captureCharFrame().includes("Loading older commits..."));

    expect(setup.captureCharFrame()).toContain("Loading older commits...");

    await act(async () => {
      release();
      await setup.renderOnce();
    });

    await waitFor(
      setup,
      () =>
        setup.renderer.root.findDescendantById(GRAPH_LOAD_OLDER_ID) === undefined &&
        !setup.captureCharFrame().includes("Loading older commits..."),
    );

    expect(setup.captureCharFrame()).not.toContain("Load older commits");
    expect(setup.captureCharFrame()).toContain("10 commits");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("loads the next page from the Load older commits button", async () => {
    const first = page(10, "buttonpage");
    let olderReads = 0;
    const fake = createGraphClient(async ({ args }) => {
      if (args.includes("--branches")) {
        return fakeGitResult(first.output);
      }

      olderReads += 1;

      return fakeGitResult(page(1, "buttonend").output);
    });
    const setup = await renderGraph(fake, 10, { height: 40 });

    await waitFor(setup, () => setup.captureCharFrame().includes("Load older commits"));

    await act(async () => {
      await click(setup, GRAPH_LOAD_OLDER_ID);
      await setup.renderOnce();
    });

    await waitFor(setup, () => setup.captureCharFrame().includes("buttonend commit 0"));

    expect(olderReads).toBe(1);
    expect(setup.renderer.root.findDescendantById(GRAPH_LOAD_OLDER_ID)).toBeUndefined();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("does not page history when the cursor reaches the last loaded row", async () => {
    const first = page(10, "nopage");
    let olderReads = 0;
    const fake = createGraphClient(async ({ args }) => {
      if (args.includes("--branches")) {
        return fakeGitResult(first.output);
      }

      olderReads += 1;

      return fakeGitResult(page(1, "nopageend").output);
    });
    const setup = await renderGraph(fake, 10, { height: 40 });

    await waitFor(setup, () => setup.captureCharFrame().includes("nopage commit 9"));

    await act(async () => {
      resolveActionHandler("nav.last", "graph")?.();
      await setup.renderOnce();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await setup.renderOnce();
    });

    expect(olderReads).toBe(0);
    expect(setup.renderer.root.findDescendantById(GRAPH_LOAD_OLDER_ID)).toBeDefined();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("blocks the load control while a graph window reload is in flight", async () => {
    const first = page(10, "inflight");
    let releaseScope: (() => void) | null = null;
    let scopeReads = 0;
    let olderReads = 0;
    const fake = createGraphClient(async ({ args }) => {
      if (args.includes("--branches")) {
        scopeReads += 1;

        if (scopeReads > 1) {
          await new Promise<void>((resolve) => {
            releaseScope = resolve;
          });
        }

        return fakeGitResult(first.output);
      }

      olderReads += 1;

      return fakeGitResult("");
    });
    const setup = await renderGraph(fake, 10, { height: 40 });

    await waitFor(setup, () => setup.captureCharFrame().includes("inflight commit 9"));

    let reload: Promise<unknown> | undefined;

    await act(async () => {
      reload = latest?.refreshGraphWindow();
      await setup.renderOnce();
    });
    await waitFor(setup, () => latest?.isGraphInFlight === true);

    expect(readActionAvailability("graph", "graph.loadOlder")).toBe(false);

    await act(async () => {
      resolveActionHandler("graph.loadOlder", "graph")?.();
      await setup.renderOnce();
    });

    expect(olderReads).toBe(0);

    await act(async () => {
      releaseScope?.();
      await reload;
      await setup.renderOnce();
    });
    await waitFor(setup, () => latest?.isGraphInFlight === false);
    await waitFor(setup, () => readActionAvailability("graph", "graph.loadOlder") === true);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("publishes load availability and keeps the load action inert in every blocked state", async () => {
    const first = page(10, "gateload");
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let olderReads = 0;
    const fake = createGraphClient(async ({ args }) => {
      if (args.includes("--branches")) {
        return fakeGitResult(first.output);
      }

      olderReads += 1;
      await gate;

      return fakeGitResult("");
    });
    const setup = await renderGraph(fake, 10, { height: 40 });

    await waitFor(setup, () => setup.captureCharFrame().includes("gateload commit 9"));
    await waitFor(setup, () => readActionAvailability("graph", "graph.loadOlder") === true);

    await act(async () => {
      resolveActionHandler("graph.loadOlder", "graph")?.();
      await setup.renderOnce();
    });
    await waitFor(setup, () => setup.captureCharFrame().includes("Loading older commits..."));

    expect(readActionAvailability("graph", "graph.loadOlder")).toBe(false);

    await act(async () => {
      resolveActionHandler("graph.loadOlder", "graph")?.();
      await setup.renderOnce();
    });

    expect(olderReads).toBe(1);

    await act(async () => {
      release();
      await setup.renderOnce();
    });
    await waitFor(setup, () => readActionAvailability("graph", "graph.loadOlder") === false);

    await act(async () => {
      resolveActionHandler("graph.loadOlder", "graph")?.();
      await setup.renderOnce();
    });

    expect(olderReads).toBe(1);

    await act(async () => {
      resolveActionHandler("graph.search", "graph")?.();
      await setup.renderOnce();
    });
    await waitFor(setup, () => readActionAvailability("graph", "graph.loadOlder") === false);

    await act(async () => {
      resolveActionHandler("graph.loadOlder", "graph")?.();
      await setup.renderOnce();
    });

    expect(olderReads).toBe(1);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("leaves a wheel-scrolled viewport in place when an older page is appended", async () => {
    const first = page(10, "stay");
    let olderReads = 0;
    const fake = createGraphClient(async ({ args }) => {
      if (args.includes("--branches")) {
        return fakeGitResult(first.output);
      }

      olderReads += 1;

      return fakeGitResult(page(5, "staynew").output);
    });
    const setup = await renderGraph(fake, 10, { height: 14 });

    await waitFor(setup, () => setup.captureCharFrame().includes("stay commit 0"));

    const scrollbox = setup.renderer.root.findDescendantById(
      GRAPH_SCROLL_ID,
    ) as ScrollBoxRenderable;

    for (let step = 0; step < 4; step += 1) {
      await act(async () => {
        await setup.mockMouse.scroll(20, 8, "down");
      });
      await act(async () => {
        await setup.renderOnce();
      });
    }

    await waitFor(setup, () => scrollbox.scrollTop > 0);

    const scrolledTop = scrollbox.scrollTop;
    const selectionBefore = latest?.selection;

    await act(async () => {
      resolveActionHandler("graph.loadOlder", "graph")?.();
      await setup.renderOnce();
    });
    await waitFor(
      setup,
      () =>
        setup.renderer.root.findDescendantById(graphRowRenderableId("staynew0004")) !== undefined,
    );

    expect(olderReads).toBe(1);
    expect(Math.abs(scrollbox.scrollTop - scrolledTop)).toBeLessThanOrEqual(GRAPH_ROW_HEIGHT);
    expect(latest?.selection).toEqual(selectionBefore);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps a wheel-scrolled viewport in place when the status footer grows", async () => {
    const rows = page(30, "staydown");
    let fail = false;
    const fake = createGraphClient(async () =>
      fail ? fakeGitResult("", false, "fatal: unable to read history") : fakeGitResult(rows.output),
    );
    const setup = await renderGraph(fake, 40, { height: 24 });

    await waitFor(setup, () => setup.captureCharFrame().includes("staydown commit 0"));

    const scrollbox = setup.renderer.root.findDescendantById(
      GRAPH_SCROLL_ID,
    ) as ScrollBoxRenderable;

    for (let step = 0; step < 6; step += 1) {
      await act(async () => {
        await setup.mockMouse.scroll(20, 8, "down");
      });
      await act(async () => {
        await setup.renderOnce();
      });
    }

    await waitFor(setup, () => scrollbox.scrollTop > 0);

    const scrolledTop = scrollbox.scrollTop;
    const selectionBefore = latest?.selection;

    fail = true;

    await act(async () => {
      await latest?.refreshGraphWindow();
      await setup.renderOnce();
    });
    await waitFor(setup, () => setup.captureCharFrame().includes(GRAPH_LOAD_ERROR_MESSAGE));
    await act(async () => {
      await setup.renderOnce();
    });

    expect(Math.abs(scrollbox.scrollTop - scrolledTop)).toBeLessThanOrEqual(GRAPH_ROW_HEIGHT);
    expect(latest?.selection).toEqual(selectionBefore);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("uses the rows above the list as the visible-range origin", async () => {
    const rows = page(30, "originmiss");
    const fake = createGraphClient(async () => fakeGitResult(rows.output));
    const setup = await renderGraph(fake, 40, { height: 14 });

    await waitFor(setup, () => setup.captureCharFrame().includes("originmiss commit 0"));

    await act(async () => {
      await latest?.selectCommit("deadbee");
      await setup.renderOnce();
    });
    await waitFor(setup, () =>
      setup.captureCharFrame().includes("Commit is not within the loaded history"),
    );

    const scrollbox = setup.renderer.root.findDescendantById(
      GRAPH_SCROLL_ID,
    ) as ScrollBoxRenderable;

    await act(async () => {
      scrollbox.scrollTop = 6;
      await setup.renderOnce();
    });

    await act(async () => {
      resolveActionHandler("nav.down", "graph")?.();
      await setup.renderOnce();
    });

    await waitFor(
      setup,
      () =>
        latest?.selection.kind === "commit" && latest.selection.oid === (rows.oids[1] as string),
    );

    expect(latest?.selection).toEqual({ kind: "commit", oid: rows.oids[1] as string });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps loaded rows usable and shows distinct details when an older page fails", async () => {
    const first = page(2, "keep");
    let olderReads = 0;
    const fake = createGraphClient(async ({ args }) => {
      if (args.includes("--branches")) {
        return fakeGitResult(first.output);
      }

      olderReads += 1;

      return fakeGitResult("", false, "fatal: unable to read history");
    });
    const setup = await renderGraph(fake, 2, { height: 40 });

    await waitFor(setup, () => setup.captureCharFrame().includes("keep commit 1"));

    await act(async () => {
      resolveActionHandler("graph.loadOlder", "graph")?.();
      await setup.renderOnce();
    });

    await waitFor(
      setup,
      () => setup.renderer.root.findDescendantById(GRAPH_RETRY_ID) !== undefined,
    );

    expect(setup.renderer.root.findDescendantById(GRAPH_RETRY_ID)).toBeDefined();
    expect(
      setup.renderer.root.findDescendantById(graphRowRenderableId(first.oids[0] ?? "")),
    ).toBeDefined();
    await waitFor(setup, () => setup.captureCharFrame().includes(GRAPH_LOAD_ERROR_MESSAGE));

    const frame = setup.captureCharFrame();

    expect(readOccurrences(frame, GRAPH_LOAD_ERROR_MESSAGE)).toBe(1);
    expect(frame).toContain("fatal: unable to read history");
    expect(readActionAvailability("graph", "graph.loadOlder")).toBe(false);

    await act(async () => {
      resolveActionHandler("graph.loadOlder", "graph")?.();
      await setup.renderOnce();
    });

    expect(olderReads).toBe(1);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows the bounded-miss row when a commit is outside the loaded history", async () => {
    const fake = createGraphClient(async () => fakeGitResult(page(2, "miss").output));
    const setup = await renderGraph(fake, 10, { height: 30 });

    await waitFor(setup, () => setup.captureCharFrame().includes("miss commit 1"));

    let selected: EnsureLoadedResult | undefined;

    await act(async () => {
      selected = await latest?.selectCommit("deadbee");
      await setup.renderOnce();
    });

    await waitFor(setup, () => setup.captureCharFrame().includes("not within the loaded history"));

    expect(selected).toBe("notFound");
    expect(setup.captureCharFrame()).toContain("Commit is not within the loaded history");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("clears the bounded-miss row when an already loaded commit is selected", async () => {
    const rows = page(2, "clear");
    const fake = createGraphClient(async () => fakeGitResult(rows.output));
    const setup = await renderGraph(fake, 10, { height: 30 });

    await waitFor(setup, () => setup.captureCharFrame().includes("clear commit 1"));

    await act(async () => {
      await latest?.selectCommit("deadbee");
      await setup.renderOnce();
    });
    await waitFor(setup, () => setup.captureCharFrame().includes("not within the loaded history"));

    expect(setup.captureCharFrame()).toContain("Commit is not within the loaded history");

    await act(async () => {
      await latest?.selectCommit(rows.oids[1] as string);
      await setup.renderOnce();
    });
    await waitFor(
      setup,
      () => !setup.captureCharFrame().includes("Commit is not within the loaded history"),
    );

    expect(setup.captureCharFrame()).not.toContain("Commit is not within the loaded history");
    expect(latest?.selection).toEqual({ kind: "commit", oid: rows.oids[1] as string });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows one distinct walk error for a failed parent walk and clears it on a loaded selection", async () => {
    let fail = false;
    const fake = createGraphClient(async ({ args }) => {
      if (args.includes("--branches")) {
        return fakeGitResult(page(7, "walk").output);
      }

      if (fail) {
        return fakeGitResult("", false, "fatal: unable to read history");
      }

      return fakeGitResult("");
    });
    const setup = await renderGraph(fake, 7, { height: 40 });

    await waitFor(setup, () => setup.captureCharFrame().includes("walk commit 1"));

    fail = true;

    let errorResult: EnsureLoadedResult | undefined;

    await act(async () => {
      errorResult = await latest?.selectCommit("missing-error");
      await setup.renderOnce();
    });
    await waitFor(setup, () => setup.captureCharFrame().includes(GRAPH_WALK_ERROR_MESSAGE));

    const errorFrame = setup.captureCharFrame();

    expect(errorResult).toBe("error");
    expect(readOccurrences(errorFrame, GRAPH_WALK_ERROR_MESSAGE)).toBe(1);
    expect(errorFrame).not.toContain(GRAPH_LOAD_ERROR_MESSAGE);
    expect(errorFrame).not.toContain("Commit is not within the loaded history");
    expect(setup.renderer.root.findDescendantById(GRAPH_RETRY_ID)).toBeUndefined();
    expect(latest?.selection).toEqual({ kind: "pending" });

    fail = false;

    await act(async () => {
      await latest?.selectCommit("walk0000");
      await setup.renderOnce();
    });
    await waitFor(setup, () => !setup.captureCharFrame().includes(GRAPH_WALK_ERROR_MESSAGE));

    expect(setup.captureCharFrame()).not.toContain(GRAPH_WALK_ERROR_MESSAGE);
    expect(latest?.selection).toEqual({ kind: "commit", oid: "walk0000" });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows the empty repository state with a selectable pending row", async () => {
    const fake = createGraphClient(async () => fakeGitResult(""));
    const setup = await renderGraph(fake);

    await waitFor(setup, () => setup.captureCharFrame().includes("No commits yet"));

    const frame = setup.captureCharFrame();

    expect(frame).toContain("No commits yet");
    expect(frame).toContain("Commit Changes");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("refreshes status when the region gains focus", async () => {
    const fake = createGraphClient(async () => fakeGitResult(page(2, "focus").output));
    const setup = await renderGraph(fake);
    const statusKey = "status --porcelain=v2 --branch -z --untracked-files=all";
    const before = fake.counts.get(statusKey) ?? 0;

    await act(async () => {
      setup.renderer.root.findDescendantById("region-graph")?.focus();
    });

    await waitFor(setup, () => (fake.counts.get(statusKey) ?? 0) > before);

    expect(fake.counts.get(statusKey) ?? 0).toBeGreaterThan(before);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("registers exactly one handler per graph action and no app or overlay action", async () => {
    const fake = createGraphClient(async () => fakeGitResult(page(2, "handlers").output));
    const setup = await renderGraph(fake);

    for (const actionId of [
      "nav.up",
      "nav.down",
      "nav.pageUp",
      "nav.pageDown",
      "nav.first",
      "nav.last",
      "nav.activate",
      "graph.search",
    ]) {
      expect(hasRegisteredAction(actionId, "graph")).toBe(true);
    }

    expect(hasRegisteredAction("app.refresh", "global")).toBe(false);
    expect(hasRegisteredAction("commit.focus", "global")).toBe(false);
    expect(hasRegisteredAction("overlay.close", "global")).toBe(false);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("selects the active commit through the provider on navigation and activation", async () => {
    const fake = createGraphClient(async () => fakeGitResult(page(2, "pick").output));
    const setup = await renderGraph(fake, 10, { height: 30 });

    await waitFor(setup, () => setup.captureCharFrame().includes("pick commit 1"));

    await act(async () => {
      resolveActionHandler("nav.down", "graph")?.();
      await setup.renderOnce();
    });
    await act(async () => {
      resolveActionHandler("nav.activate", "graph")?.();
      await setup.renderOnce();
    });

    expect(latest?.selection).toEqual({ kind: "commit", oid: "pick0000" });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the selected commit and loaded window when a reload page read fails", async () => {
    const rows = page(4, "keep");
    let fail = false;
    const fake = createGraphClient(async () =>
      fail ? fakeGitResult("", false, "fatal: unable to read history") : fakeGitResult(rows.output),
    );
    const setup = await renderGraph(fake, 10, { height: 30 });

    await waitFor(setup, () => setup.captureCharFrame().includes("keep commit 2"));

    await act(async () => {
      resolveActionHandler("nav.down", "graph")?.();
      await setup.renderOnce();
    });

    expect(latest?.selection).toEqual({ kind: "commit", oid: rows.oids[0] as string });

    fail = true;

    await act(async () => {
      await latest?.refreshGraphWindow();
      await setup.renderOnce();
    });

    expect(latest?.selection).toEqual({ kind: "commit", oid: rows.oids[0] as string });
    expect(
      setup.renderer.root.findDescendantById(graphRowRenderableId(rows.oids[0] ?? "")),
    ).toBeDefined();
    expect(setup.captureCharFrame()).toContain("keep commit 0");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the selection when the reload restoration walk fails and Retry restores it", async () => {
    const external = Array.from(
      { length: 10 },
      (_, index) => `ext${String(index).padStart(4, "0")}`,
    );
    const history = Array.from(
      { length: 10 },
      (_, index) => `hist${String(index).padStart(4, "0")}`,
    );
    const order = [...external, ...history];
    const subjects: Readonly<Record<string, string>> = {
      ext0000: "external commit",
      ...Object.fromEntries(history.map((oid, index) => [oid, `hist commit ${index}`])),
    };
    const snapshot = { tipOid: "hist0000" };
    let failContinuation = false;
    const fake = createGraphClient(async ({ args }) => {
      const formatIndex = args.findIndex((arg) => arg.startsWith("--format="));
      const hasScope = args.includes("--branches");
      const frontier = hasScope ? [] : args.slice(formatIndex + 1);

      if (failContinuation && !hasScope) {
        return fakeGitResult("", false, "fatal: unable to read history");
      }

      const start = hasScope
        ? order.indexOf(snapshot.tipOid)
        : Math.min(...frontier.map((oid) => order.indexOf(oid)).filter((index) => index >= 0));

      return fakeGitResult(
        orderedRecordPage(order, subjects, start < 0 ? order.length : start, 10, snapshot.tipOid),
      );
    });
    const setup = await renderGraph(
      {
        client: createSnapshotClient(fake, snapshot),
        counts: fake.counts,
        setLogHandler: fake.setLogHandler,
      },
      10,
      { height: 40 },
    );

    await waitFor(setup, () => setup.captureCharFrame().includes("hist commit 3"));

    await act(async () => {
      await latest?.selectCommit("hist0003");
      await setup.renderOnce();
    });

    failContinuation = true;
    snapshot.tipOid = "ext0000";

    await act(async () => {
      await latest?.refreshStatus();
      await setup.renderOnce();
    });
    await waitFor(
      setup,
      () => setup.renderer.root.findDescendantById(GRAPH_WALK_RETRY_ID) !== undefined,
    );

    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).toContain(GRAPH_WALK_ERROR_MESSAGE);
    expect(latest?.selection).toEqual({ kind: "commit", oid: "hist0003" });

    failContinuation = false;

    await act(async () => {
      await click(setup, GRAPH_WALK_RETRY_ID);
      await setup.renderOnce();
    });
    await waitFor(
      setup,
      () =>
        setup.captureCharFrame().includes("external commit") &&
        setup.captureCharFrame().includes("hist commit 3"),
    );

    expect(latest?.selection).toEqual({ kind: "commit", oid: "hist0003" });
    expect(setup.captureCharFrame()).toContain("external commit");
    expect(setup.captureCharFrame()).not.toContain(GRAPH_WALK_ERROR_MESSAGE);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps every loaded page and the selection after a successful refresh", async () => {
    const first = page(2, "multi");
    const secondOutput = [
      record({
        oid: "multi0002",
        subject: "multi commit 2",
        parents: ["multi0003"],
      }),
      record({ oid: "multi0003", subject: "multi commit 3", parents: [] }),
    ].join("");
    const fake = createGraphClient(async ({ args }) => {
      const continuation = args.includes("multi0002");

      return continuation ? fakeGitResult(secondOutput) : fakeGitResult(first.output);
    });
    const setup = await renderGraph(fake, 2, { height: 40 });

    await waitFor(setup, () => setup.captureCharFrame().includes("multi commit 1"));

    await act(async () => {
      resolveActionHandler("graph.loadOlder", "graph")?.();
      await setup.renderOnce();
    });
    await waitFor(setup, () => setup.captureCharFrame().includes("multi commit 3"));

    await act(async () => {
      resolveActionHandler("nav.first", "graph")?.();
      await setup.renderOnce();
    });
    await act(async () => {
      resolveActionHandler("nav.down", "graph")?.();
      await setup.renderOnce();
    });

    expect(latest?.selection).toEqual({ kind: "commit", oid: first.oids[0] as string });

    await act(async () => {
      await latest?.refreshGraphWindow();
      await setup.renderOnce();
    });
    await waitFor(setup, () => setup.captureCharFrame().includes("multi commit 3"));

    expect(latest?.selection).toEqual({ kind: "commit", oid: first.oids[0] as string });
    expect(setup.captureCharFrame()).toContain("multi commit 2");
    expect(setup.captureCharFrame()).toContain("multi commit 3");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("reloads the window in topo order when a scope tip appears after the first page", async () => {
    const order = ["ext0001", "main0001", "main0002", "main0003"];
    const parentsByOid: Readonly<Record<string, readonly string[]>> = {
      ext0001: ["main0001"],
      main0001: ["main0002"],
      main0002: ["main0003"],
      main0003: [],
    };
    const subjects: Readonly<Record<string, string>> = {
      ext0001: "external commit",
      main0001: "main commit 0",
      main0002: "main commit 1",
      main0003: "main commit 2",
    };
    const snapshot = { tipOid: "main0001" };
    let firstPageReads = 0;
    const fake = createGraphClient(async ({ args }) => {
      const formatIndex = args.findIndex((arg) => arg.startsWith("--format="));
      const hasScope = args.includes("--branches");
      const frontier = hasScope ? [] : args.slice(formatIndex + 1);

      if (hasScope) {
        firstPageReads += 1;
      }

      const start = hasScope
        ? order.indexOf(snapshot.tipOid)
        : Math.min(...frontier.map((oid) => order.indexOf(oid)).filter((index) => index >= 0));
      const page = order.slice(start, start + 2);

      return fakeGitResult(
        page
          .map((oid) =>
            record({
              oid,
              subject: subjects[oid] as string,
              parents: parentsByOid[oid],
              decorations: oid === snapshot.tipOid ? ["refs/heads/main"] : [],
            }),
          )
          .join(""),
      );
    });
    const setup = await renderGraph(
      {
        client: createSnapshotClient(fake, snapshot),
        counts: fake.counts,
        setLogHandler: fake.setLogHandler,
      },
      2,
      { height: 40 },
    );

    await waitFor(setup, () => setup.captureCharFrame().includes("main commit 1"));

    const baselinePageReads = firstPageReads;

    await waitFor(setup, () => latest?.isGraphInFlight === false);

    await act(async () => {
      await latest?.selectCommit("main0001");
      await setup.renderOnce();
    });

    expect(latest?.selection).toEqual({ kind: "commit", oid: "main0001" });

    snapshot.tipOid = "ext0001";

    await act(async () => {
      await latest?.refreshStatus();
      await setup.renderOnce();
    });
    await waitFor(setup, () => setup.captureCharFrame().includes("external commit"));

    const frame = setup.captureCharFrame();
    const externalIndex = frame.indexOf("external commit");
    const firstMainIndex = frame.indexOf("main commit 0");

    expect(firstPageReads).toBe(baselinePageReads + 1);
    expect(latest?.selection).toEqual({ kind: "commit", oid: "main0001" });
    expect(externalIndex).toBeGreaterThanOrEqual(0);
    expect(externalIndex).toBeLessThan(firstMainIndex);
    expect(readOccurrences(frame, "external commit")).toBe(1);
    expect(readOccurrences(frame, "main commit 0")).toBe(1);

    await act(async () => {
      resolveActionHandler("graph.loadOlder", "graph")?.();
      await setup.renderOnce();
    });
    await waitFor(setup, () => setup.captureCharFrame().includes("main commit 2"));

    const olderFrame = setup.captureCharFrame();

    expect(setup.renderer.root.findDescendantById(GRAPH_LOAD_OLDER_ID)).toBeUndefined();
    expect(readOccurrences(olderFrame, "main commit 0")).toBe(1);
    expect(readOccurrences(olderFrame, "main commit 1")).toBe(1);
    expect(readOccurrences(olderFrame, "main commit 2")).toBe(1);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("does not re-read the window when a combined refresh joins a reload that recorded the current tip", async () => {
    const order = ["ext0001", "main0001", "main0002", "main0003"];
    const parentsByOid: Readonly<Record<string, readonly string[]>> = {
      ext0001: ["main0001"],
      main0001: ["main0002"],
      main0002: ["main0003"],
      main0003: [],
    };
    const subjects: Readonly<Record<string, string>> = {
      ext0001: "external commit",
      main0001: "main commit 0",
      main0002: "main commit 1",
      main0003: "main commit 2",
    };
    const snapshot = { tipOid: "main0001" };
    let firstPageReads = 0;
    let armed = false;
    let gated = false;
    let gatedReads = 0;
    let releaseGate = (): void => {};
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const fake = createGraphClient(async ({ args }) => {
      const formatIndex = args.findIndex((arg) => arg.startsWith("--format="));
      const hasScope = args.includes("--branches");
      const frontier = hasScope ? [] : args.slice(formatIndex + 1);

      if (hasScope) {
        firstPageReads += 1;

        if (armed && gatedReads === 0) {
          gatedReads += 1;
          gated = true;
          await gate;
        }
      }

      const start = hasScope
        ? order.indexOf(snapshot.tipOid)
        : Math.min(...frontier.map((oid) => order.indexOf(oid)).filter((index) => index >= 0));
      const slice = order.slice(start, start + 2);

      return fakeGitResult(
        slice
          .map((oid) =>
            record({
              oid,
              subject: subjects[oid] as string,
              parents: parentsByOid[oid],
              decorations: oid === snapshot.tipOid ? ["refs/heads/main"] : [],
            }),
          )
          .join(""),
      );
    });
    const setup = await renderGraph(
      {
        client: createSnapshotClient(fake, snapshot),
        counts: fake.counts,
        setLogHandler: fake.setLogHandler,
      },
      2,
      { height: 40 },
    );

    await waitFor(setup, () => setup.captureCharFrame().includes("main commit 1"));
    await waitFor(
      setup,
      () => latest?.isGraphInFlight === false && latest?.isStatusInFlight === false,
    );

    const baselinePageReads = firstPageReads;

    snapshot.tipOid = "ext0001";
    armed = true;

    // The status read publishes the new tip, and the tips path starts the reload from the rendered
    // key. Gating its first page read lets the combined refresh join that reload.
    await act(async () => {
      await latest?.refreshStatus();
      await setup.renderOnce();
    });
    await waitFor(setup, () => gated);

    let combined: Promise<unknown> | undefined;

    await act(async () => {
      combined = latest?.refresh();
      await setup.renderOnce();
    });
    await waitFor(setup, () => latest?.isStatusInFlight === false && gated);

    await act(async () => {
      releaseGate();
      await combined;
      await setup.renderOnce();
    });
    await waitFor(setup, () => setup.captureCharFrame().includes("external commit"));
    await waitFor(
      setup,
      () => latest?.isGraphInFlight === false && latest?.isStatusInFlight === false,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      await setup.renderOnce();
    });

    expect(firstPageReads).toBe(baselinePageReads + 1);
    expect(readOccurrences(setup.captureCharFrame(), "external commit")).toBe(1);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("renders and keeps the selected commit when a new tip pushes it outside the re-read window", async () => {
    const history = Array.from(
      { length: 20 },
      (_, index) => `hist${String(index).padStart(4, "0")}`,
    );
    const order = ["ext0001", ...history];
    const subjects = Object.fromEntries(
      order.map((oid) => [
        oid,
        oid === "ext0001" ? "external commit" : `hist commit ${Number(oid.slice(4))}`,
      ]),
    );
    const snapshot = { tipOid: "hist0000" };
    const fake = createGraphClient(async ({ args }) => {
      const formatIndex = args.findIndex((arg) => arg.startsWith("--format="));
      const hasScope = args.includes("--branches");
      const frontier = hasScope ? [] : args.slice(formatIndex + 1);
      const start = hasScope
        ? order.indexOf(snapshot.tipOid)
        : Math.min(...frontier.map((oid) => order.indexOf(oid)).filter((index) => index >= 0));

      return fakeGitResult(
        orderedRecordPage(order, subjects, start < 0 ? order.length : start, 10, snapshot.tipOid),
      );
    });
    const setup = await renderGraph(
      {
        client: createSnapshotClient(fake, snapshot),
        counts: fake.counts,
        setLogHandler: fake.setLogHandler,
      },
      10,
      { height: 60 },
    );

    await waitFor(setup, () => setup.captureCharFrame().includes("hist commit 9"));

    await act(async () => {
      resolveActionHandler("nav.last", "graph")?.();
      await setup.renderOnce();
    });
    await waitFor(setup, () => setup.captureCharFrame().includes("hist commit 19"));

    await act(async () => {
      await latest?.selectCommit("hist0019");
      await setup.renderOnce();
    });
    await waitFor(
      setup,
      () => latest?.selection.kind === "commit" && latest.selection.oid === "hist0019",
    );

    expect(latest?.selection).toEqual({ kind: "commit", oid: "hist0019" });

    snapshot.tipOid = "ext0001";

    await act(async () => {
      await latest?.refreshStatus();
      await setup.renderOnce();
    });
    await waitFor(
      setup,
      () =>
        setup.captureCharFrame().includes("external commit") &&
        setup.captureCharFrame().includes("hist commit 19"),
    );

    expect(latest?.selection).toEqual({ kind: "commit", oid: "hist0019" });
    expect(setup.renderer.root.findDescendantById(graphRowRenderableId("hist0019"))).toBeDefined();
    expect(setup.captureCharFrame()).toContain("hist commit 19");

    await act(async () => {
      resolveActionHandler("nav.last", "graph")?.();
      await setup.renderOnce();
    });

    expect(latest?.selection).toEqual({ kind: "commit", oid: "hist0019" });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the new tip when a status refresh lands during the tip reload", async () => {
    const history = ["late0000", "late0001", "late0002", "late0003"];
    const order = ["ext0001", ...history];
    const subjects = Object.fromEntries(
      order.map((oid) => [
        oid,
        oid === "ext0001" ? "external commit" : `late commit ${Number(oid.slice(4))}`,
      ]),
    );
    const snapshot = { tipOid: "late0000" };
    let gated = false;
    let releaseGate = (): void => {};
    let releaseResolver = (): void => {};
    const gate = new Promise<void>((resolve) => {
      releaseResolver = resolve;
    });

    releaseGate = () => {
      releaseResolver();
    };

    const fake = createGraphClient(async ({ args }) => {
      const formatIndex = args.findIndex((arg) => arg.startsWith("--format="));
      const hasScope = args.includes("--branches");
      const frontier = hasScope ? [] : args.slice(formatIndex + 1);

      if (!hasScope && frontier.includes("late0001")) {
        gated = true;
        await gate;
      }

      const start = hasScope
        ? order.indexOf(snapshot.tipOid)
        : Math.min(...frontier.map((oid) => order.indexOf(oid)).filter((index) => index >= 0));

      return fakeGitResult(
        orderedRecordPage(order, subjects, start < 0 ? order.length : start, 2, snapshot.tipOid),
      );
    });
    const setup = await renderGraph(
      {
        client: createSnapshotClient(fake, snapshot),
        counts: fake.counts,
        setLogHandler: fake.setLogHandler,
      },
      2,
      { height: 40 },
    );

    await waitFor(setup, () => setup.captureCharFrame().includes("late commit 1"));

    await act(async () => {
      resolveActionHandler("nav.last", "graph")?.();
      await setup.renderOnce();
    });
    await waitFor(setup, () => setup.captureCharFrame().includes("late commit 3"));
    await waitFor(setup, () => latest?.isGraphInFlight === false);

    await act(async () => {
      await latest?.selectCommit("late0002");
      await setup.renderOnce();
    });

    expect(latest?.selection).toEqual({ kind: "commit", oid: "late0002" });

    snapshot.tipOid = "ext0001";

    await act(async () => {
      await latest?.refreshStatus();
      await setup.renderOnce();
    });
    await waitFor(setup, () => gated);

    await act(async () => {
      await latest?.refreshStatus();
      await setup.renderOnce();
    });

    await act(async () => {
      releaseGate();
      await setup.renderOnce();
    });
    await waitFor(
      setup,
      () =>
        setup.captureCharFrame().includes("external commit") &&
        setup.captureCharFrame().includes("late commit 2"),
    );

    const frame = setup.captureCharFrame();

    expect(frame).toContain("late commit 0");
    expect(frame).toContain("late commit 2");
    expect(latest?.selection).toEqual({ kind: "commit", oid: "late0002" });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("loads a second tip that arrives while the tip reload is in flight", async () => {
    const order = ["ext0002", "ext0001", "late0000", "late0001", "late0002", "late0003"];
    const subjects: Readonly<Record<string, string>> = {
      ext0002: "second external commit",
      ext0001: "external commit",
      late0000: "late commit 0",
      late0001: "late commit 1",
      late0002: "late commit 2",
      late0003: "late commit 3",
    };
    const snapshot = { tipOid: "late0000" };
    let gated = false;
    let releaseGate = (): void => {};
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const fake = createGraphClient(async ({ args }) => {
      const formatIndex = args.findIndex((arg) => arg.startsWith("--format="));
      const hasScope = args.includes("--branches");
      const frontier = hasScope ? [] : args.slice(formatIndex + 1);

      if (!hasScope && frontier.includes("late0001")) {
        gated = true;
        await gate;
      }

      const start = hasScope
        ? order.indexOf(snapshot.tipOid)
        : Math.min(...frontier.map((oid) => order.indexOf(oid)).filter((index) => index >= 0));

      return fakeGitResult(
        orderedRecordPage(order, subjects, start < 0 ? order.length : start, 2, snapshot.tipOid),
      );
    });
    const setup = await renderGraph(
      {
        client: createSnapshotClient(fake, snapshot),
        counts: fake.counts,
        setLogHandler: fake.setLogHandler,
      },
      2,
      { height: 40 },
    );

    await waitFor(setup, () => setup.captureCharFrame().includes("late commit 1"));

    await act(async () => {
      resolveActionHandler("nav.last", "graph")?.();
      await setup.renderOnce();
    });
    await waitFor(setup, () => setup.captureCharFrame().includes("late commit 3"));
    await waitFor(setup, () => latest?.isGraphInFlight === false);

    await act(async () => {
      await latest?.selectCommit("late0002");
      await setup.renderOnce();
    });

    snapshot.tipOid = "ext0001";

    await act(async () => {
      await latest?.refreshStatus();
      await setup.renderOnce();
    });
    await waitFor(setup, () => gated);

    snapshot.tipOid = "ext0002";

    await act(async () => {
      await latest?.refreshStatus();
      await setup.renderOnce();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      await setup.renderOnce();
    });

    await act(async () => {
      releaseGate();
      await setup.renderOnce();
    });
    await waitFor(
      setup,
      () =>
        setup.captureCharFrame().includes("second external commit") &&
        setup.captureCharFrame().includes("late commit 2"),
    );

    const frame = setup.captureCharFrame();

    expect(frame).toContain("second external commit");
    expect(frame).toContain("external commit");
    expect(latest?.selection).toEqual({ kind: "commit", oid: "late0002" });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("loads a commit created while a manual graph-window reload is in flight", async () => {
    const history = ["late0000", "late0001", "late0002", "late0003"];
    const order = ["ext0001", ...history];
    const subjects: Readonly<Record<string, string>> = {
      ext0001: "external commit",
      late0000: "late commit 0",
      late0001: "late commit 1",
      late0002: "late commit 2",
      late0003: "late commit 3",
    };
    const snapshot = { tipOid: "late0000" };
    let armed = false;
    let gated = false;
    let releaseGate = (): void => {};
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const fake = createGraphClient(async ({ args }) => {
      const formatIndex = args.findIndex((arg) => arg.startsWith("--format="));
      const hasScope = args.includes("--branches");
      const frontier = hasScope ? [] : args.slice(formatIndex + 1);

      if (armed && !hasScope) {
        gated = true;
        await gate;
      }

      const start = hasScope
        ? order.indexOf(snapshot.tipOid)
        : Math.min(...frontier.map((oid) => order.indexOf(oid)).filter((index) => index >= 0));

      return fakeGitResult(
        orderedRecordPage(order, subjects, start < 0 ? order.length : start, 2, snapshot.tipOid),
      );
    });
    const setup = await renderGraph(
      {
        client: createSnapshotClient(fake, snapshot),
        counts: fake.counts,
        setLogHandler: fake.setLogHandler,
      },
      2,
      { height: 40 },
    );

    await waitFor(setup, () => setup.captureCharFrame().includes("late commit 1"));

    await act(async () => {
      resolveActionHandler("nav.last", "graph")?.();
      await setup.renderOnce();
    });
    await waitFor(setup, () => setup.captureCharFrame().includes("late commit 3"));
    await waitFor(setup, () => latest?.isGraphInFlight === false);

    let manual: Promise<unknown> | undefined;

    await act(async () => {
      armed = true;
      manual = latest?.refreshGraphWindow();
      await setup.renderOnce();
    });
    await waitFor(setup, () => gated);

    snapshot.tipOid = "ext0001";

    await act(async () => {
      await latest?.refreshStatus();
      await setup.renderOnce();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      await setup.renderOnce();
    });

    await act(async () => {
      releaseGate();
      await manual;
      await setup.renderOnce();
    });
    await waitFor(setup, () => setup.captureCharFrame().includes("external commit"));

    expect(setup.captureCharFrame()).toContain("external commit");
    expect(setup.captureCharFrame()).toContain("late commit 0");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("re-reads the window from Retry after a failed tip reload", async () => {
    const history = ["retry0000", "retry0001", "retry0002", "retry0003"];
    const order = ["ext0001", ...history];
    const subjects: Readonly<Record<string, string>> = {
      ext0001: "external commit",
      retry0000: "retry commit 0",
      retry0001: "retry commit 1",
      retry0002: "retry commit 2",
      retry0003: "retry commit 3",
    };
    const snapshot = { tipOid: "retry0000" };
    let fail = false;
    const fake = createGraphClient(async ({ args }) => {
      if (fail) {
        return fakeGitResult("", false, "fatal: unable to read history");
      }

      const formatIndex = args.findIndex((arg) => arg.startsWith("--format="));
      const hasScope = args.includes("--branches");
      const frontier = hasScope ? [] : args.slice(formatIndex + 1);
      const start = hasScope
        ? order.indexOf(snapshot.tipOid)
        : Math.min(...frontier.map((oid) => order.indexOf(oid)).filter((index) => index >= 0));

      return fakeGitResult(
        orderedRecordPage(order, subjects, start < 0 ? order.length : start, 10, snapshot.tipOid),
      );
    });
    const setup = await renderGraph(
      {
        client: createSnapshotClient(fake, snapshot),
        counts: fake.counts,
        setLogHandler: fake.setLogHandler,
      },
      10,
      { height: 40 },
    );

    await waitFor(setup, () => setup.captureCharFrame().includes("retry commit 2"));
    await waitFor(setup, () => latest?.isGraphInFlight === false);

    fail = true;
    snapshot.tipOid = "ext0001";

    await act(async () => {
      await latest?.refreshStatus();
      await setup.renderOnce();
    });
    await waitFor(
      setup,
      () => setup.renderer.root.findDescendantById(GRAPH_RETRY_ID) !== undefined,
    );

    expect(setup.captureCharFrame()).toContain("retry commit 0");
    expect(setup.captureCharFrame()).not.toContain("external commit");
    expect(latest?.selection).toEqual({ kind: "pending" });

    fail = false;

    await act(async () => {
      await click(setup, GRAPH_RETRY_ID);
      await setup.renderOnce();
    });
    await waitFor(setup, () => setup.captureCharFrame().includes("external commit"));

    expect(setup.captureCharFrame()).toContain("external commit");
    expect(setup.captureCharFrame()).toContain("retry commit 0");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("reads the first history page once during startup", async () => {
    const rows = page(2, "boot");
    let scopeReads = 0;
    const fake = createGraphClient(async ({ args }) => {
      if (args.includes("--branches")) {
        scopeReads += 1;
      }

      return fakeGitResult(rows.output);
    });
    const setup = await renderGraph(fake, 10, { height: 30 });

    await waitFor(setup, () => setup.captureCharFrame().includes("boot commit 0"));
    await waitFor(
      setup,
      () => latest?.isGraphInFlight === false && latest?.isStatusInFlight === false,
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      await setup.renderOnce();
    });

    expect(scopeReads).toBe(1);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("discards an in-flight older page after a status refresh and can load again", async () => {
    const first = page(2, "keep");
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let olderCalls = 0;
    const fake = createGraphClient(async ({ args }) => {
      if (args.includes("--branches")) {
        return fakeGitResult(first.output);
      }

      olderCalls += 1;

      if (olderCalls === 1) {
        await gate;

        return fakeGitResult(page(2, "stale").output);
      }

      return fakeGitResult(page(2, "fresh").output);
    });
    const setup = await renderGraph(fake, 2, { height: 40 });

    await waitFor(setup, () => setup.captureCharFrame().includes("keep commit 1"));

    await act(async () => {
      resolveActionHandler("graph.loadOlder", "graph")?.();
      await setup.renderOnce();
    });
    await waitFor(setup, () => setup.captureCharFrame().includes("Loading older commits..."));

    await act(async () => {
      await latest?.refreshStatus();
      await setup.renderOnce();
    });

    await act(async () => {
      release();
      await setup.renderOnce();
    });
    await waitFor(setup, () => !setup.captureCharFrame().includes("Loading older commits..."));

    expect(setup.captureCharFrame()).not.toContain("stale commit 0");

    await act(async () => {
      resolveActionHandler("graph.loadOlder", "graph")?.();
      await setup.renderOnce();
    });

    await waitFor(setup, () => setup.captureCharFrame().includes("fresh commit 0"));

    expect(setup.captureCharFrame()).toContain("fresh commit 0");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("refuses to open search in an empty repository and reports the reason", async () => {
    const fake = createGraphClient(async () => fakeGitResult(""));
    const setup = await renderGraph(fake);

    await waitFor(setup, () => setup.captureCharFrame().includes("No commits yet"));

    await act(async () => {
      resolveActionHandler("graph.search", "graph")?.();
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).not.toContain("Search commit messages...");
    expect(latestStatus?.status?.message).toBe("No commits to search");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("closes an open search when the repository becomes empty", async () => {
    const rows = page(3, "shrink");
    let empty = false;
    const fake = createGraphClient(async () =>
      empty ? fakeGitResult("") : fakeGitResult(rows.output),
    );
    const setup = await renderGraph(fake);

    await waitFor(setup, () => setup.captureCharFrame().includes("shrink commit 2"));

    await act(async () => {
      resolveActionHandler("graph.search", "graph")?.();
      await setup.renderOnce();
    });

    expect(setup.renderer.root.findDescendantById(GRAPH_SEARCH_INPUT_ID)).toBeDefined();

    empty = true;

    await act(async () => {
      await latest?.refreshGraphWindow();
      await setup.renderOnce();
    });
    await waitFor(
      setup,
      () => setup.renderer.root.findDescendantById(GRAPH_SEARCH_INPUT_ID) === undefined,
    );

    expect(setup.renderer.root.findDescendantById(GRAPH_SEARCH_INPUT_ID)).toBeUndefined();
    expect(latestStatus?.status?.message).toBe("No commits to search");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("closes an open search when the repository generation moves", async () => {
    const rows = page(3, "moved");
    const fake = createGraphClient(async () => fakeGitResult(rows.output));
    const setup = await renderGraph(fake);

    await waitFor(setup, () => setup.captureCharFrame().includes("moved commit 2"));

    await act(async () => {
      resolveActionHandler("graph.search", "graph")?.();
      await setup.renderOnce();
    });

    expect(setup.renderer.root.findDescendantById(GRAPH_SEARCH_INPUT_ID)).toBeDefined();

    const before = latest?.generation ?? 0;

    await act(async () => {
      await latest?.refreshStatus();
      await setup.renderOnce();
    });
    await waitFor(
      setup,
      () => setup.renderer.root.findDescendantById(GRAPH_SEARCH_INPUT_ID) === undefined,
    );

    expect(latest?.generation).toBeGreaterThan(before);
    expect(setup.renderer.root.findDescendantById(GRAPH_SEARCH_INPUT_ID)).toBeUndefined();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("budgets rows inside the scrollbar when the panel is narrower than the terminal", async () => {
    const rows = page(10, "narrow", 42);
    const fake = createGraphClient(async () => fakeGitResult(rows.output));
    const setup = await testRender(
      <AppTestProviders gitClient={fake.client} config={configWithPageSize(10)}>
        <NarrowGraphHost />
      </AppTestProviders>,
      { width: 80, height: 24 },
    );

    await waitFor(setup, () => setup.captureCharFrame().includes("narrow commit 0"));

    const line =
      setup
        .captureCharFrame()
        .split("\n")
        .find((row) => row.includes("narrow commit 0")) ?? "";

    expect(line).toContain("narrow commit 0");
    expect(line).toContain("42");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("scrolls the search results on the wheel without moving the result cursor", async () => {
    const rows = page(30, "find");
    const fake = createGraphClient(async () => fakeGitResult(rows.output));
    const setup = await renderGraph(fake, 40, { height: 14 });

    await waitFor(setup, () => setup.captureCharFrame().includes("find commit 0"));

    await act(async () => {
      resolveActionHandler("graph.search", "graph")?.();
      await setup.renderOnce();
    });

    await waitFor(
      setup,
      () => setup.renderer.root.findDescendantById(GRAPH_SEARCH_INPUT_ID) !== undefined,
    );

    await act(async () => {
      await setup.mockInput.typeText("find");
    });
    await waitFor(
      setup,
      () =>
        setup.renderer.root.findDescendantById(searchResultRowId(rows.oids[0] ?? "")) !== undefined,
    );

    const scrollbox = setup.renderer.root.findDescendantById(
      GRAPH_SCROLL_ID,
    ) as ScrollBoxRenderable;

    for (let step = 0; step < 4; step += 1) {
      await act(async () => {
        await setup.mockMouse.scroll(20, 8, "down");
      });
      await act(async () => {
        await setup.renderOnce();
      });
    }

    await waitFor(setup, () => scrollbox.scrollTop > 0);

    expect(scrollbox.scrollTop).toBeGreaterThan(0);

    await act(async () => {
      resolveActionHandler("nav.activate", "graph")?.();
      await setup.renderOnce();
    });

    expect(latest?.selection).toEqual({
      kind: "commit",
      oid: rows.oids[0] as string,
    });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("reveals the selected search result through the same scrollbox", async () => {
    const rows = page(30, "matches");
    const fake = createGraphClient(async () => fakeGitResult(rows.output));
    const setup = await renderGraph(fake, 40, { height: 14 });

    await waitFor(setup, () => setup.captureCharFrame().includes("matches commit 0"));

    await act(async () => {
      resolveActionHandler("graph.search", "graph")?.();
      await setup.renderOnce();
    });
    await waitFor(
      setup,
      () => setup.renderer.root.findDescendantById(GRAPH_SEARCH_INPUT_ID) !== undefined,
    );

    await act(async () => {
      await setup.mockInput.typeText("matches");
    });
    await waitFor(
      setup,
      () =>
        setup.renderer.root.findDescendantById(searchResultRowId(rows.oids[29] ?? "")) !==
        undefined,
    );

    const scrollbox = setup.renderer.root.findDescendantById(
      GRAPH_SCROLL_ID,
    ) as ScrollBoxRenderable;

    expect(scrollbox.scrollTop).toBe(0);

    await act(async () => {
      resolveActionHandler("nav.last", "graph")?.();
      await setup.renderOnce();
    });
    await waitFor(setup, () => isRowInsideViewport(setup, searchResultRowId(rows.oids[29] ?? "")));

    const row = setup.renderer.root.findDescendantById(searchResultRowId(rows.oids[29] ?? ""));

    expect(scrollbox.scrollTop).toBeGreaterThan(0);
    expect(row?.y).toBeGreaterThanOrEqual(scrollbox.viewport.y);
    expect((row?.y ?? 0) + (row?.height ?? 0)).toBeLessThanOrEqual(
      scrollbox.viewport.y + scrollbox.viewport.height,
    );

    await act(async () => {
      await setup.dispose();
    });
  });

  it("re-anchors the search result cursor to the visible results after a native scroll", async () => {
    const rows = page(30, "searchanchor");
    const fake = createGraphClient(async () => fakeGitResult(rows.output));
    const setup = await renderGraph(fake, 40, { height: 14 });

    await waitFor(setup, () => setup.captureCharFrame().includes("searchanchor commit 0"));

    await act(async () => {
      resolveActionHandler("graph.search", "graph")?.();
      await setup.renderOnce();
    });
    await waitFor(
      setup,
      () => setup.renderer.root.findDescendantById(GRAPH_SEARCH_INPUT_ID) !== undefined,
    );

    await act(async () => {
      await setup.mockInput.typeText("searchanchor");
    });
    await waitFor(
      setup,
      () =>
        setup.renderer.root.findDescendantById(searchResultRowId(rows.oids[0] ?? "")) !== undefined,
    );

    const scrollbox = setup.renderer.root.findDescendantById(
      GRAPH_SCROLL_ID,
    ) as ScrollBoxRenderable;

    for (let step = 0; step < 6; step += 1) {
      await act(async () => {
        await setup.mockMouse.scroll(20, 8, "down");
      });
      await act(async () => {
        await setup.renderOnce();
      });
    }

    await waitFor(setup, () => scrollbox.scrollTop > 0);

    const scrolledTop = scrollbox.scrollTop;
    const firstVisible = Math.floor(scrolledTop / GRAPH_ROW_HEIGHT);

    await act(async () => {
      resolveActionHandler("nav.down", "graph")?.();
      await setup.renderOnce();
    });
    await act(async () => {
      resolveActionHandler("nav.activate", "graph")?.();
      await setup.renderOnce();
    });

    await waitFor(
      setup,
      () =>
        latest?.selection.kind === "commit" &&
        latest.selection.oid === (rows.oids[firstVisible] as string),
    );

    expect(latest?.selection).toEqual({
      kind: "commit",
      oid: rows.oids[firstVisible] as string,
    });
    await waitFor(
      setup,
      () => setup.renderer.root.findDescendantById(GRAPH_SEARCH_INPUT_ID) === undefined,
    );

    await act(async () => {
      await setup.dispose();
    });
  });

  it("reveals an off-screen confirmed search result after the body switches back to the graph", async () => {
    const rows = page(30, "confirm");
    const fake = createGraphClient(async () => fakeGitResult(rows.output));
    const setup = await renderGraph(fake, 40, { height: 14 });

    await waitFor(setup, () => setup.captureCharFrame().includes("confirm commit 0"));

    await act(async () => {
      resolveActionHandler("graph.search", "graph")?.();
      await setup.renderOnce();
    });
    await waitFor(
      setup,
      () => setup.renderer.root.findDescendantById(GRAPH_SEARCH_INPUT_ID) !== undefined,
    );

    await act(async () => {
      await setup.mockInput.typeText("confirm");
    });
    await waitFor(
      setup,
      () =>
        setup.renderer.root.findDescendantById(searchResultRowId(rows.oids[0] ?? "")) !== undefined,
    );

    await act(async () => {
      resolveActionHandler("nav.last", "graph")?.();
      await setup.renderOnce();
    });
    await waitFor(
      setup,
      () => isRowInsideViewport(setup, searchResultRowId(rows.oids[29] ?? "")) === true,
    );

    const scrollbox = setup.renderer.root.findDescendantById(
      GRAPH_SCROLL_ID,
    ) as ScrollBoxRenderable;

    let steps = 0;

    while (scrollbox.scrollTop > 0 && steps < 200) {
      await act(async () => {
        await setup.mockMouse.scroll(20, 8, "up");
      });
      await act(async () => {
        await setup.renderOnce();
      });
      steps += 1;
    }

    expect(steps).toBeLessThan(200);
    expect(scrollbox.scrollTop).toBe(0);
    expect(isRowInsideViewport(setup, searchResultRowId(rows.oids[29] ?? ""))).toBe(false);

    await act(async () => {
      resolveActionHandler("nav.activate", "graph")?.();
      await setup.renderOnce();
    });

    await waitFor(
      setup,
      () =>
        latest?.selection.kind === "commit" && latest.selection.oid === (rows.oids[29] as string),
    );
    await waitFor(
      setup,
      () => setup.renderer.root.findDescendantById(GRAPH_SEARCH_INPUT_ID) === undefined,
    );
    await waitFor(setup, () =>
      isRowInsideViewport(setup, graphRowRenderableId(rows.oids[29] ?? "")),
    );

    expect(isRowInsideViewport(setup, graphRowRenderableId(rows.oids[29] ?? ""))).toBe(true);
    expect(latest?.selection).toEqual({ kind: "commit", oid: rows.oids[29] as string });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("restores the pre-search selection and reveals it when search is cancelled", async () => {
    const rows = page(30, "session");
    const fake = createGraphClient(async () => fakeGitResult(rows.output));
    const setup = await renderGraph(fake, 40, { height: 14 });

    await waitFor(setup, () => setup.captureCharFrame().includes("session commit 0"));

    for (let step = 0; step < 10; step += 1) {
      await act(async () => {
        resolveActionHandler("nav.down", "graph")?.();
        await setup.renderOnce();
      });
    }

    await waitFor(setup, () => latest?.selection.kind === "commit");

    const selectedOid = latest?.selection.kind === "commit" ? latest.selection.oid : "";

    await act(async () => {
      resolveActionHandler("graph.search", "graph")?.();
      await setup.renderOnce();
    });
    await waitFor(
      setup,
      () => setup.renderer.root.findDescendantById(GRAPH_SEARCH_INPUT_ID) !== undefined,
    );

    await act(async () => {
      await setup.mockInput.typeText("session");
    });
    await waitFor(
      setup,
      () =>
        setup.renderer.root.findDescendantById(searchResultRowId(rows.oids[0] ?? "")) !== undefined,
    );

    await act(async () => {
      resolveActionHandler("nav.last", "graph")?.();
      await setup.renderOnce();
    });

    await act(async () => {
      expect(clearFocusedInput(GRAPH_SEARCH_INPUT_ID)).toBe(true);
      await setup.renderOnce();
    });
    await waitFor(
      setup,
      () => setup.renderer.root.findDescendantById(GRAPH_SEARCH_INPUT_ID) === undefined,
    );
    await waitFor(
      setup,
      () => latest?.selection.kind === "commit" && latest.selection.oid === selectedOid,
    );
    await waitFor(setup, () => isRowInsideViewport(setup, graphRowRenderableId(selectedOid)));

    expect(isRowInsideViewport(setup, graphRowRenderableId(selectedOid))).toBe(true);
    expect(latest?.selection).toEqual({ kind: "commit", oid: selectedOid });

    await act(async () => {
      await setup.dispose();
    });
  });
});
