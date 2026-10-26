import { beforeEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode, useEffect } from "react";
import {
  hasRegisteredAction,
  registerAction,
  resetActionRegistry,
  resolveActionHandler,
} from "@/app/hooks/useAction";
import { useRepository } from "@/app/hooks/useRepository";
import { COMMIT_DETAILS_FORMAT_VERSION } from "@/domain/git/git.log";
import type { GitClient, GitInvocationResult } from "@/domain/git/git.types";
import type { EnsureLoadedResult } from "@/domain/graph/graph.types";
import { useCommitDetails } from "@/features/commit-details/useCommitDetails";
import { AppTestProviders } from "@/test/app.harness";
import { createFakeGitClient, fakeGitResult } from "@/test/git.fake";

/** NUL field separator of the details fixture. */
const NUL = "\x00";

/** Record marker of the details fixture. */
const RS = "\x1e";

/** First selection OID. */
const OID_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

/** Second selection OID. */
const OID_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

/** Third selection OID. */
const OID_C = "cccccccccccccccccccccccccccccccccccccccc";

/** First parent OID. */
const PARENT_ONE = "1111111111111111111111111111111111111111";

/** Second parent OID. */
const PARENT_TWO = "2222222222222222222222222222222222222222";

/** Captured hook handle. */
let latest: ReturnType<typeof useCommitDetails> | undefined;

/** Captured repository context. */
let repository: ReturnType<typeof useRepository> | undefined;

/**
 * Builds one details record fixture.
 *
 * @param oid - Commit OID.
 * @param subject - Subject shown in the message body.
 * @param parents - Parent OIDs.
 * @returns The record bytes.
 */
function detailsRecord(oid: string, subject: string, parents: readonly string[] = []): string {
  const fields = [
    oid,
    oid.slice(0, 7),
    "tree000",
    parents.join(" "),
    "Alice Ng",
    "alice@example.com",
    "2026-10-25T09:30:00+00:00",
    "Alice Ng",
    "alice@example.com",
    "2026-10-25T09:30:00+00:00",
    "",
    `${subject}\n`,
  ].join(NUL);

  return `${RS}${COMMIT_DETAILS_FORMAT_VERSION}${NUL}${fields}\n`;
}

/** Fixture subject per OID. */
const SUBJECTS: Readonly<Record<string, string>> = Object.freeze({
  [OID_A]: "subject a",
  [OID_B]: "subject b",
  [OID_C]: "subject c",
  [PARENT_ONE]: "parent one",
  [PARENT_TWO]: "parent two",
});

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
 * Reports whether an argument list is the raw commit read.
 *
 * @param args - Git arguments.
 * @returns True for the raw log read.
 */
function isRawRead(args: readonly string[]): boolean {
  return args[0] === "log" && args.includes("--raw");
}

/**
 * Records the previously observed reads that were already aborted before this one started.
 *
 * @param signals - Signals captured per OID.
 * @param oid - OID that just started.
 * @param abortedAtStart - Collector for the aborted OIDs.
 */
function recordAbortedSignals(
  signals: ReadonlyMap<string, AbortSignal>,
  oid: string,
  abortedAtStart: string[],
): void {
  for (const [candidate, signal] of signals) {
    if (candidate !== oid && signal.aborted) {
      abortedAtStart.push(candidate);
    }
  }
}

/** Fixture parent list per OID. */
const PARENTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  [OID_A]: Object.freeze([PARENT_ONE, PARENT_TWO]),
});

/**
 * Creates a fake client that answers commit details and stats reads.
 *
 * A gate can hold the details answer for one OID, which lets a test change the selection while the
 * previous read is still in flight. Every invocation records its signal, so the test can prove the
 * previous read was cancelled before the next one started.
 *
 * @returns The client plus its recorded state and gate helpers.
 */
function createHookClient() {
  const base = createFakeGitClient();
  const detailsCounts = new Map<string, number>();
  const signals = new Map<string, AbortSignal>();
  const gates = new Map<string, Promise<void>>();
  const failures = new Set<string>();
  const abortedAtStart: string[] = [];

  /**
   * Records one details read and answers it after the optional gate.
   *
   * @param options - Invocation options from the details read.
   * @returns The details record or the scripted failure.
   */
  async function answerDetails(
    options: Parameters<GitClient["invoke"]>[0],
  ): Promise<GitInvocationResult> {
    const oid = options.args.at(-1) ?? "";

    detailsCounts.set(oid, (detailsCounts.get(oid) ?? 0) + 1);
    signals.set(oid, options.signal);
    recordAbortedSignals(signals, oid, abortedAtStart);

    const gate = gates.get(oid);

    if (gate !== undefined) {
      await gate;
    }

    return failures.has(oid)
      ? fakeGitResult("", false, `fatal: bad object ${oid}`)
      : fakeGitResult(detailsRecord(oid, SUBJECTS[oid] ?? "subject", PARENTS[oid] ?? []));
  }

  const client: GitClient = {
    gitPath: "git",
    invoke: async (options): Promise<GitInvocationResult> => {
      if (isDetailsRead(options.args)) {
        return await answerDetails(options);
      }

      if (isStatsRead(options.args)) {
        return fakeGitResult("2\t1\tfile.txt");
      }

      if (isRawRead(options.args)) {
        return fakeGitResult("");
      }

      return await base.client.invoke(options);
    },
  };

  return {
    client,
    detailsCounts,
    signals,
    failures,
    abortedAtStart,
    /**
     * Holds the details answer of one OID until the returned release runs.
     *
     * @param oid - OID whose details read is held.
     * @returns The release function.
     */
    gate(oid: string): () => void {
      let release: () => void = () => {};

      gates.set(
        oid,
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );

      return () => {
        gates.delete(oid);
        release();
      };
    },
  };
}

/** Commits the fixture selection and captures the hook handle. */
function DetailsProbe(props: { readonly oid: string }): ReactNode {
  const current = useRepository();

  useEffect(() => {
    if (current.snapshot !== null) {
      current.setSelection({ kind: "commit", oid: props.oid });
    }
  }, [current.snapshot, current.setSelection, props.oid]);

  repository = current;
  latest = useCommitDetails();

  return (
    <>
      <text id="hook-status">{latest.status}</text>
      <text id="hook-subject">{latest.details?.message ?? ""}</text>
      <text id="hook-bounded-miss">{latest.boundedMiss ? "bounded miss" : ""}</text>
      <text id="hook-parent-index">{String(latest.parentIndex)}</text>
    </>
  );
}

/** Registers a scripted commit navigator and optionally a duplicate action. */
function NavigatorProbe(props: {
  readonly result: EnsureLoadedResult;
  readonly navigated: string[];
  readonly duplicateAction?: "nav.up";
  readonly onDuplicate?: () => void;
}): null {
  const current = useRepository();

  useEffect(() => {
    current.registerCommitNavigator(async (oid) => {
      props.navigated.push(oid);

      return props.result;
    });

    return () => {
      current.registerCommitNavigator(null);
    };
  }, [current.registerCommitNavigator, props.navigated, props.result]);

  useEffect(() => {
    if (props.duplicateAction === undefined) {
      return;
    }

    return registerAction(props.duplicateAction, { scope: "right-pane" }, () => {
      props.onDuplicate?.();
    });
  }, [props.duplicateAction, props.onDuplicate]);

  return null;
}

/**
 * Renders the details hook probe inside the app providers.
 *
 * @param fake - Fake client.
 * @param oid - Initial commit OID.
 * @param props - Optional navigator result and recorder.
 * @returns The renderer setup.
 */
async function renderHook(
  fake: ReturnType<typeof createHookClient>,
  oid: string = OID_A,
  props: {
    readonly navigatorResult?: EnsureLoadedResult;
    readonly navigated?: string[];
    readonly duplicateAction?: "nav.up";
    readonly onDuplicate?: () => void;
  } = {},
): Promise<Awaited<ReturnType<typeof testRender>>> {
  const navigated = props.navigated ?? [];
  const setup = await testRender(
    <AppTestProviders gitClient={fake.client}>
      <DetailsProbe oid={oid} />
      {props.navigatorResult === undefined ? null : (
        <NavigatorProbe
          result={props.navigatorResult}
          navigated={navigated}
          duplicateAction={props.duplicateAction}
          onDuplicate={props.onDuplicate}
        />
      )}
    </AppTestProviders>,
    { width: 90, height: 20 },
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
  timeoutMs: number = 3_000,
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
 * Selects one commit through the provider.
 *
 * @param oid - Commit to select.
 * @param setup - Renderer setup.
 */
async function select(setup: Awaited<ReturnType<typeof testRender>>, oid: string): Promise<void> {
  await act(async () => {
    repository?.setSelection({ kind: "commit", oid });
    await setup.renderOnce();
  });
}

beforeEach(() => {
  resetActionRegistry();
  latest = undefined;
  repository = undefined;
});

describe("useCommitDetails", () => {
  it("loads the selected commit and debounces an intermediate selection", async () => {
    const fake = createHookClient();
    const setup = await renderHook(fake);

    await select(setup, OID_A);
    await waitFor(setup, () => latest?.details?.oid === OID_A);

    await act(async () => {
      repository?.setSelection({ kind: "commit", oid: OID_B });
      repository?.setSelection({ kind: "commit", oid: OID_C });
      await setup.renderOnce();
    });

    await waitFor(setup, () => latest?.details?.oid === OID_C);

    expect(fake.detailsCounts.get(OID_B) ?? 0).toBe(0);
    expect(fake.detailsCounts.get(OID_C) ?? 0).toBeGreaterThan(0);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("cancels the previous read and discards its stale result", async () => {
    const fake = createHookClient();
    const releaseA = fake.gate(OID_A);
    const setup = await renderHook(fake);

    await waitFor(setup, () => (fake.detailsCounts.get(OID_A) ?? 0) > 0);

    await select(setup, OID_B);
    await waitFor(setup, () => latest?.details?.oid === OID_B);

    expect(fake.signals.get(OID_A)?.aborted).toBe(true);
    expect(fake.abortedAtStart).toContain(OID_A);

    await act(async () => {
      releaseA();
      await setup.renderOnce();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      await setup.renderOnce();
    });

    expect(latest?.details?.oid).toBe(OID_B);
    expect(latest?.details?.message).toBe("subject b");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the previous details visible while the next read runs", async () => {
    const fake = createHookClient();
    const setup = await renderHook(fake);

    await waitFor(setup, () => latest?.details?.oid === OID_A);

    const releaseB = fake.gate(OID_B);

    await select(setup, OID_B);
    await waitFor(setup, () => (fake.detailsCounts.get(OID_B) ?? 0) > 0);

    expect(latest?.details?.oid).toBe(OID_A);
    expect(latest?.isLoading).toBe(true);

    await act(async () => {
      releaseB();
      await setup.renderOnce();
    });

    await waitFor(setup, () => latest?.details?.oid === OID_B);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("clears the previous commit when the next read settles with an error", async () => {
    const fake = createHookClient();
    const setup = await renderHook(fake);

    await waitFor(setup, () => latest?.details?.oid === OID_A);

    fake.failures.add(OID_B);

    await select(setup, OID_B);
    await waitFor(setup, () => latest?.error !== null);

    expect(latest?.status).toBe("error");
    expect(latest?.details).toBeNull();
    expect(latest?.parents).toEqual([]);
    expect(repository?.selection).toEqual({ kind: "commit", oid: OID_B });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the selection on a failure and recovers on retry", async () => {
    const fake = createHookClient();

    fake.failures.add(OID_A);

    const setup = await renderHook(fake);

    await waitFor(setup, () => latest?.error !== null);

    expect(repository?.selection).toEqual({ kind: "commit", oid: OID_A });
    expect(latest?.status).toBe("error");

    fake.failures.delete(OID_A);

    await act(async () => {
      latest?.retry();
      await setup.renderOnce();
    });

    await waitFor(setup, () => latest?.details?.oid === OID_A);

    expect(repository?.selection).toEqual({ kind: "commit", oid: OID_A });
    expect(latest?.error).toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("selects the parent under the cursor through the repository selector", async () => {
    const fake = createHookClient();
    const navigated: string[] = [];
    const setup = await renderHook(fake, OID_A, {
      navigatorResult: "loaded",
      navigated,
    });

    await waitFor(setup, () => latest?.parents.length === 2);

    await act(async () => {
      resolveActionHandler("nav.down", "right-pane")?.();
      await setup.renderOnce();
    });

    expect(latest?.parentIndex).toBe(1);

    await act(async () => {
      resolveActionHandler("nav.activate", "right-pane")?.();
      await setup.renderOnce();
    });

    await waitFor(
      setup,
      () => repository?.selection.kind === "commit" && repository.selection.oid === PARENT_TWO,
    );

    expect(navigated).toEqual([PARENT_TWO]);
    expect(repository?.selection).toEqual({ kind: "commit", oid: PARENT_TWO });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows the bounded-miss message and keeps the selection when the parent is not loaded", async () => {
    const fake = createHookClient();
    const setup = await renderHook(fake, OID_A, { navigatorResult: "exceeded" });

    await waitFor(setup, () => latest?.parents.length === 2);

    await act(async () => {
      resolveActionHandler("nav.activate", "right-pane")?.();
      await setup.renderOnce();
    });

    await waitFor(setup, () => latest?.boundedMiss === true);

    expect(latest?.boundedMiss).toBe(true);
    expect(latest?.isLoadingParent).toBe(false);
    expect(repository?.selection).toEqual({ kind: "commit", oid: OID_A });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("stays neutral when a refresh cancels the parent walk", async () => {
    const fake = createHookClient();
    const setup = await renderHook(fake, OID_A, { navigatorResult: "cancelled" });

    await waitFor(setup, () => latest?.parents.length === 2);

    await act(async () => {
      resolveActionHandler("nav.activate", "right-pane")?.();
      await setup.renderOnce();
    });

    await waitFor(setup, () => latest?.isLoadingParent === false);

    expect(latest?.boundedMiss).toBe(false);
    expect(repository?.selection).toEqual({ kind: "commit", oid: OID_A });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("stays neutral when the parent walk failed a page read", async () => {
    const fake = createHookClient();
    const setup = await renderHook(fake, OID_A, { navigatorResult: "error" });

    await waitFor(setup, () => latest?.parents.length === 2);

    await act(async () => {
      resolveActionHandler("nav.activate", "right-pane")?.();
      await setup.renderOnce();
    });

    await waitFor(setup, () => latest?.isLoadingParent === false);

    expect(latest?.boundedMiss).toBe(false);
    expect(repository?.selection).toEqual({ kind: "commit", oid: OID_A });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("registers only the parent navigation actions in the right pane", async () => {
    const fake = createHookClient();
    const setup = await renderHook(fake);

    await waitFor(setup, () => latest?.details?.oid === OID_A);

    for (const actionId of ["nav.up", "nav.down", "nav.activate"]) {
      expect(hasRegisteredAction(actionId, "right-pane")).toBe(true);
    }

    for (const actionId of ["nav.first", "nav.last", "nav.pageUp", "nav.pageDown"]) {
      expect(hasRegisteredAction(actionId, "right-pane")).toBe(false);
    }

    expect(hasRegisteredAction("app.refresh", "global")).toBe(false);
    expect(hasRegisteredAction("commit.focus", "global")).toBe(false);
    expect(hasRegisteredAction("overlay.close", "global")).toBe(false);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("rejects a duplicate right-pane navigation registration", async () => {
    const fake = createHookClient();
    let duplicates = 0;
    const original = console.error;
    const messages: string[] = [];

    console.error = (...args: unknown[]) => {
      messages.push(args.map((value) => String(value)).join(" "));
    };

    try {
      const setup = await renderHook(fake, OID_A, {
        navigatorResult: "loaded",
        duplicateAction: "nav.up",
        onDuplicate: () => {
          duplicates += 1;
        },
      });

      await waitFor(setup, () => latest?.details?.oid === OID_A);

      await act(async () => {
        resolveActionHandler("nav.up", "right-pane")?.();
        await setup.renderOnce();
      });

      expect(duplicates).toBe(0);
      expect(messages.some((message) => message.includes("Duplicate action handler"))).toBe(true);

      await act(async () => {
        await setup.dispose();
      });
    } finally {
      console.error = original;
    }
  });
});
