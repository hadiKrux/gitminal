import { beforeEach, describe, expect, it } from "bun:test";
import { CodeRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, useEffect } from "react";
import { resetActionRegistry } from "@/app/hooks/useAction";
import { useRepository } from "@/app/hooks/useRepository";
import { COMMIT_DETAILS_FORMAT_VERSION } from "@/domain/git/git.log";
import type { GitClient, GitInvocationResult } from "@/domain/git/git.types";
import { CommitDetails } from "@/features/commit-details/CommitDetails";
import {
  COMMIT_DETAILS_MESSAGE_TOGGLE_ID,
  COMMIT_DETAILS_RETRY_ID,
} from "@/features/commit-details/useCommitDetails";
import { AppTestProviders } from "@/test/app.harness";
import { createFakeGitClient, fakeGitResult } from "@/test/git.fake";

/** NUL field separator of the details fixture. */
const NUL = "\x00";

/** Record marker of the details fixture. */
const RS = "\x1e";

/** Full fixture OID used by most cases. */
const OID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

/** Parent fixture OID. */
const PARENT_OID = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

/** Fixture short hash. */
const SHORT_OID = "aaaaaaa";

/** Fixture tree OID. */
const TREE_OID = "cccccccccccccccccccccccccccccccccccccccc";

/** Fixture stats output. */
const STATS_OUTPUT = ["4\t1\tsrc/app.ts", "6\t1\tsrc/ui/panel.ts", "0\t0\told.txt"].join("\n");

/** Fixture details and stats per OID. */
interface CommitFixture {
  readonly message?: string;
  readonly parents?: readonly string[];
  readonly decorations?: readonly string[];
  readonly committerName?: string;
  readonly committerEmail?: string;
  readonly committerDate?: string;
  readonly authorName?: string;
  readonly authorEmail?: string;
  readonly authorDate?: string;
  readonly stats?: string;
}

/**
 * Builds one versioned details record.
 *
 * @param oid - Commit OID.
 * @param fixture - Field overrides.
 * @returns The record bytes.
 */
function detailsRecord(oid: string, fixture: CommitFixture = {}): string {
  const fields = [
    oid,
    oid.slice(0, 7),
    TREE_OID,
    (fixture.parents ?? []).join(" "),
    withDefault(fixture.authorName, "Alice Ng"),
    withDefault(fixture.authorEmail, "alice@example.com"),
    withDefault(fixture.authorDate, "2026-10-25T09:30:00+05:00"),
    withDefault(fixture.committerName, "Alice Ng"),
    withDefault(fixture.committerEmail, "alice@example.com"),
    withDefault(fixture.committerDate, "2026-10-25T09:30:00+05:00"),
    (fixture.decorations ?? []).join(", "),
    withDefault(fixture.message, "feat: add details pane\n\nExplain the new pane.\n"),
  ].join(NUL);

  return `${RS}${COMMIT_DETAILS_FORMAT_VERSION}${NUL}${fields}\n`;
}

/**
 * Applies a fixture default when the override is absent.
 *
 * @param value - Candidate override.
 * @param fallback - Default fixture value.
 * @returns The override or the default.
 */
function withDefault<T>(value: T | undefined, fallback: T): T {
  return value ?? fallback;
}

/**
 * Reports whether an argument list is the details read.
 *
 * @param args - Git arguments.
 * @returns True for the decorated, non-raw log read.
 */
function isDetailsRead(args: readonly string[]): boolean {
  return args[0] === "log" && args.includes("--decorate=full") && !args.includes("--raw");
}

/**
 * Reports whether an argument list is the stats read.
 *
 * @param args - Git arguments.
 * @returns True for the numstat, non-raw log read.
 */
function isStatsRead(args: readonly string[]): boolean {
  return args[0] === "log" && args.includes("--numstat") && !args.includes("--raw");
}

/**
 * Creates a fake client that answers commit details and stats reads.
 *
 * Every other invocation delegates to the shared repository fake, so the provider still reads a
 * normal repository. The details and stats answers are swappable to exercise loading and retry.
 *
 * @param initial - Details per OID and optional stats per OID.
 * @returns The client plus its mutable answer state.
 */
function createDetailsClient(initial: Readonly<Record<string, CommitFixture>> = {}) {
  const base = createFakeGitClient();
  const fixtures = new Map<string, CommitFixture>(Object.entries(initial));
  const calls = new Map<string, number>();
  let failDetails = false;

  /**
   * Answers one details read from the mutable fixture map.
   *
   * @param args - Git arguments.
   * @returns The details record or the scripted failure.
   */
  function answerDetails(args: readonly string[]): GitInvocationResult {
    const oid = args.at(-1) ?? "";
    const fixture = fixtures.get(oid);

    if (failDetails || fixture === undefined) {
      return fakeGitResult("", false, `fatal: bad object ${oid}`);
    }

    return fakeGitResult(detailsRecord(oid, fixture));
  }

  /**
   * Answers one stats read from the mutable fixture map.
   *
   * @param args - Git arguments.
   * @returns The stats output or the scripted failure.
   */
  function answerStats(args: readonly string[]): GitInvocationResult {
    const oid = args.at(-1) ?? "";
    const fixture = fixtures.get(oid);

    return fixture === undefined
      ? fakeGitResult("", false, `fatal: bad object ${oid}`)
      : fakeGitResult(fixture.stats ?? STATS_OUTPUT);
  }

  const client: GitClient = {
    gitPath: "git",
    invoke: async (options): Promise<GitInvocationResult> => {
      const key = options.args.join(" ");

      calls.set(key, (calls.get(key) ?? 0) + 1);

      if (isDetailsRead(options.args)) {
        return answerDetails(options.args);
      }

      if (isStatsRead(options.args)) {
        return answerStats(options.args);
      }

      return await base.client.invoke(options);
    },
  };

  return {
    client,
    fixtures,
    calls,
    /**
     * Sets the details failure flag for the next reads.
     *
     * @param value - True to answer every details read with a git failure.
     */
    setFailDetails(value: boolean): void {
      failDetails = value;
    },
  };
}

/** Keeps the provider selection on one commit. */
function SelectCommit(props: { readonly oid: string }): null {
  const repository = useRepository();

  useEffect(() => {
    repository.setSelection({ kind: "commit", oid: props.oid });
  }, [props.oid, repository.setSelection]);

  return null;
}

/**
 * Renders the details pane for one selected commit.
 *
 * @param fake - Details client.
 * @param oid - OID to select, or null to leave the pending selection.
 * @param size - Pane width and height plus the terminal width when the pane is narrower.
 * @returns The renderer setup.
 */
async function renderDetails(
  fake: ReturnType<typeof createDetailsClient>,
  oid: string | null = OID,
  size: {
    readonly width?: number;
    readonly height?: number;
    readonly terminalWidth?: number;
  } = {},
): Promise<Awaited<ReturnType<typeof testRender>>> {
  const width = size.width ?? 90;

  const setup = await testRender(
    <AppTestProviders gitClient={fake.client}>
      {oid === null ? null : <SelectCommit oid={oid} />}
      <box flexDirection="column" width={width} height={size.height ?? 30}>
        <CommitDetails />
      </box>
    </AppTestProviders>,
    { width: size.terminalWidth ?? width, height: (size.height ?? 30) + 2 },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
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

beforeEach(() => {
  resetActionRegistry();
});

describe("CommitDetails", () => {
  it("renders every field, both hash code blocks, refs, parents, stats, and the message", async () => {
    const fake = createDetailsClient({
      [OID]: {
        parents: [PARENT_OID],
        decorations: ["tag: refs/tags/v1.0.0", "refs/heads/main", "refs/remotes/origin/main"],
      },
    });
    const setup = await renderDetails(fake);

    await waitFor(setup, () => setup.captureCharFrame().includes("feat: add details pane"));

    const frame = setup.captureCharFrame();

    expect(frame).toContain(`Commit ${SHORT_OID}`);
    expect(frame).toContain(SHORT_OID);
    expect(frame).toContain("Full hash");
    expect(frame).toContain("Tree hash");
    expect(frame).toContain("Author: Alice Ng <alice@example.com>");
    expect(frame).toContain("2026-10-25T09:30:00+05:00");
    expect(frame).toContain("[v1.0.0]");
    expect(frame).toContain("[main]");
    expect(frame).toContain("[origin/main]");
    expect(frame).toContain(PARENT_OID.slice(0, 7));
    expect(frame).toContain("3 files changed +10 -2");
    expect(frame).toContain("Explain the new pane.");
    expect(frame).toContain("read-only");

    const fullHash = setup.renderer.root.findDescendantById("commit-full-hash");
    const treeHash = setup.renderer.root.findDescendantById("commit-tree-hash");
    const message = setup.renderer.root.findDescendantById("commit-message");

    expect(fullHash).toBeInstanceOf(CodeRenderable);
    expect(treeHash).toBeInstanceOf(CodeRenderable);
    expect(message).toBeInstanceOf(CodeRenderable);
    expect((fullHash as CodeRenderable).content).toBe(OID);
    expect((treeHash as CodeRenderable).content).toBe(TREE_OID);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows No parents for a root commit and No refs when nothing points at it", async () => {
    const fake = createDetailsClient({ [OID]: { parents: [] } });
    const setup = await renderDetails(fake);

    await waitFor(setup, () => setup.captureCharFrame().includes("No parents"));

    const frame = setup.captureCharFrame();

    expect(frame).toContain("No parents");
    expect(frame).toContain("No refs");
    expect(setup.renderer.root.findDescendantById("commit-parents-empty")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("commit-refs-empty")).toBeDefined();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the author row inside a narrow pane whose scrollbar is visible", async () => {
    const fake = createDetailsClient({
      [OID]: {
        authorName: "A Writer With A Very Long Display Name",
        authorEmail: "a.very.long.email.address@example-with-long-domain.test",
      },
    });
    const setup = await renderDetails(fake, OID, { width: 40, height: 30, terminalWidth: 80 });

    await waitFor(setup, () => setup.captureCharFrame().includes("Author:"));

    const line =
      setup
        .captureCharFrame()
        .split("\n")
        .find((row) => row.includes("Author:")) ?? "";

    expect(line).toContain("...");

    const withoutBorder = Array.from(line)
      .filter((character) => character.codePointAt(0) !== 0x2502)
      .join("");

    expect(withoutBorder.trimEnd().endsWith("...")).toBe(true);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("renders the committer row only when it differs from the author", async () => {
    const matching = createDetailsClient({ [OID]: {} });
    const matchingSetup = await renderDetails(matching);

    await waitFor(matchingSetup, () =>
      matchingSetup.captureCharFrame().includes("Author: Alice Ng"),
    );

    expect(matchingSetup.captureCharFrame()).not.toContain("Committer:");

    await act(async () => {
      await matchingSetup.dispose();
    });

    const differing = createDetailsClient({
      [OID]: {
        committerName: "Rebase Bot",
        committerEmail: "bot@example.com",
        committerDate: "2026-10-26T11:00:00+01:00",
      },
    });
    const differingSetup = await renderDetails(differing);

    await waitFor(differingSetup, () =>
      differingSetup.captureCharFrame().includes("Committer: Rebase Bot"),
    );

    const frame = differingSetup.captureCharFrame();

    expect(frame).toContain("Committer: Rebase Bot <bot@example.com>");
    expect(frame).toContain("differs from author");

    await act(async () => {
      await differingSetup.dispose();
    });
  });

  it("shows the loading row while the read is in flight", async () => {
    const base = createFakeGitClient();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const client: GitClient = {
      gitPath: "git",
      invoke: async (options) => {
        if (
          options.args[0] === "log" &&
          options.args.includes("--decorate=full") &&
          !options.args.includes("--raw")
        ) {
          await gate;

          return fakeGitResult(detailsRecord(OID));
        }

        return await base.client.invoke(options);
      },
    };
    const setup = await testRender(
      <AppTestProviders gitClient={client}>
        <SelectCommit oid={OID} />
        <box flexDirection="column" width={90} height={30}>
          <CommitDetails />
        </box>
      </AppTestProviders>,
      { width: 90, height: 32 },
    );

    await act(async () => {
      await setup.renderOnce();
    });
    await waitFor(setup, () => setup.captureCharFrame().includes("Loading commit details..."));

    expect(setup.captureCharFrame()).toContain("Loading commit details...");

    await act(async () => {
      release();
      await setup.renderOnce();
    });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the selection on a details failure and retries from the error state", async () => {
    const fake = createDetailsClient({ [OID]: {} });

    fake.setFailDetails(true);

    const setup = await renderDetails(fake);

    await waitFor(setup, () => setup.captureCharFrame().includes("Could not load commit details"));

    expect(setup.captureCharFrame()).toContain("Could not load commit details");
    expect(setup.captureCharFrame()).toContain("bad object");
    expect(setup.renderer.root.findDescendantById(COMMIT_DETAILS_RETRY_ID)).toBeDefined();

    fake.setFailDetails(false);

    await act(async () => {
      await click(setup, COMMIT_DETAILS_RETRY_ID);
      await setup.renderOnce();
    });

    await waitFor(setup, () => setup.captureCharFrame().includes("Author: Alice Ng"));

    expect(setup.captureCharFrame()).toContain("Author: Alice Ng");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("collapses a long message and expands it from the visible toggle", async () => {
    const lines = Array.from({ length: 12 }, (_, index) => `message line ${index + 1}`);
    const fake = createDetailsClient({
      [OID]: { message: `${lines.join("\n")}\n` },
    });
    const setup = await renderDetails(fake);

    await waitFor(setup, () => setup.captureCharFrame().includes("message line 1"));

    const collapsed = setup.captureCharFrame();

    expect(collapsed).toContain("message line 8");
    expect(collapsed).not.toContain("message line 12");
    expect(collapsed).toContain("Show full message");

    await act(async () => {
      await click(setup, COMMIT_DETAILS_MESSAGE_TOGGLE_ID);
      await setup.renderOnce();
    });

    await waitFor(setup, () => setup.captureCharFrame().includes("message line 12"));

    expect(setup.captureCharFrame()).toContain("Show less");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows the stats rows that were read plus the truncation note at the cap", async () => {
    const stats = Array.from({ length: 201 }, (_, index) => `1\t0\tfile-${index}.txt`).join("\n");
    const fake = createDetailsClient({ [OID]: { stats } });
    const setup = await renderDetails(fake);

    await waitFor(setup, () => setup.captureCharFrame().includes("stats truncated"));

    const frame = setup.captureCharFrame();

    expect(frame).toContain("200 files changed +200 -0");
    expect(frame).toContain("stats truncated");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("renders nothing when the selection is not a commit", async () => {
    const fake = createDetailsClient({});
    const setup = await renderDetails(fake, null);

    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).not.toContain("Commit");
    expect(setup.captureCharFrame()).not.toContain("Loading commit details...");

    await act(async () => {
      await setup.dispose();
    });
  });
});
