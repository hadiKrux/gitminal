import { type MutableRefObject, useCallback, useEffect, useRef, useState } from "react";
import type { GraphPaginator } from "@/domain/graph/graph.types";
import type { TipsEffectContext, TipsEffectInput } from "@/features/graph/graph.types";

/** Bounded number of window reloads one tips effect may issue while tips keep changing. */
const GRAPH_TIPS_RELOAD_ATTEMPTS = 3;

/** Bounded number of consecutive loops one convergence sequence may run. */
const GRAPH_TIPS_RELOAD_ROUNDS = 2;

/**
 * Reloads the window when the scope-tip key changes after the first page.
 *
 * The paginator seeds its cursor from the scope tips only before the first page. A tip that appears
 * later can descend from an emitted commit, so folding it into the current cursor would poison the
 * frontier, and dropping it would hide the new commit until a manual refresh. The reload runs
 * through the provider refresher, so it owns the graph in-flight flag, a second graph refresh joins
 * it instead of starting another, and a status refresh cannot cancel it.
 *
 * After every settle the loop compares the key the reload started with the current key and the key
 * recorded by the successful reloader, and starts another reload while they differ. The recorded key
 * is authoritative: a joined reload that started before the tip recorded the old key, so a
 * `coalesced` join needs no extra attempt when it seeded and recorded the current key. Within one
 * loop the reload runs at most `GRAPH_TIPS_RELOAD_ATTEMPTS` times. When the last attempt succeeded
 * but the tip key changed again, the effect re-arms itself once so a fourth distinct change is
 * loaded instead of silently forgotten. At most `GRAPH_TIPS_RELOAD_ROUNDS` consecutive loops run;
 * if the key keeps changing past that bound, the newest key is left for the next page append, search
 * toggle, or successful external window reload, which resets the bound. The loop's own successful
 * attempts never reset it, or the bound would be defeated. Failures stop the loop, keep the key
 * unrecorded, and leave the feature's page error in place so the existing Retry action can run the
 * window reload again; a failed reload is never re-armed silently. A new paginator resets the record
 * because that window was already seeded from the current tips.
 *
 * @param input - Paginator, tip key, loading state, provider refresher, and reload bookkeeping refs.
 */
export function useScopeTipsReload(input: {
  readonly paginator: GraphPaginator;
  readonly pagesLoaded: number;
  readonly refreshGraphWindow: () => Promise<{
    readonly ok: boolean;
    readonly coalesced: boolean;
    readonly error: string | null;
  }>;
  readonly scopeTipsKey: string;
  readonly searchOpen: boolean;
  readonly setPageError: (message: string | null) => void;
  readonly tipsPaginatorRef: MutableRefObject<GraphPaginator>;
  readonly recordedTipsKeyRef: MutableRefObject<string>;
  readonly reloadingTipsRef: MutableRefObject<boolean>;
  readonly scopeTipsKeyRef: MutableRefObject<string>;
}): void {
  const {
    paginator,
    pagesLoaded,
    recordedTipsKeyRef,
    refreshGraphWindow,
    reloadingTipsRef,
    scopeTipsKey,
    scopeTipsKeyRef,
    searchOpen,
    setPageError,
    tipsPaginatorRef,
  } = input;
  const [reArmTick, setReArmTick] = useState(0);
  const roundsRef = useRef(0);
  const contextRef = useRef<TipsEffectContext>({ paginator, pagesLoaded, searchOpen });
  const previousRecordedKeyRef = useRef(recordedTipsKeyRef.current);
  const loopRecordedKeyRef = useRef<string | null>(null);

  /**
   * Runs the bounded reload loop for the current tip set.
   *
   * @returns A promise that settles after the loop releases the in-flight guard.
   */
  const reloadForTips = useCallback(async (): Promise<void> => {
    reloadingTipsRef.current = true;

    try {
      for (let attempt = 0; attempt < GRAPH_TIPS_RELOAD_ATTEMPTS; attempt += 1) {
        const startedKey = scopeTipsKeyRef.current;
        const result = await refreshGraphWindow();

        if (!result.ok) {
          // The reloader already published its specific page error when it rolled back. A thrown
          // reloader carries its message here instead.
          if (result.error !== null) {
            setPageError(result.error);
          }

          return;
        }

        const latestKey = scopeTipsKeyRef.current;

        // A joined reload may predate the tip that triggered this call, but the recorded key proves
        // whether it seeded the current tip set, so only the key comparison decides the outcome.
        if (latestKey === startedKey && recordedTipsKeyRef.current === startedKey) {
          roundsRef.current = 0;

          return;
        }
      }

      // The last attempt succeeded, yet the tip key moved again. Re-arm the effect once so the newest
      // key is handled within the round bound; a further change waits for the next external trigger.
      if (recordedTipsKeyRef.current !== scopeTipsKeyRef.current) {
        setReArmTick((tick) => tick + 1);
      }
    } finally {
      // Remember the key this loop recorded so the external-reload reset below does not mistake the
      // loop's own successful attempts for an external trigger and defeat the round bound.
      loopRecordedKeyRef.current = recordedTipsKeyRef.current;
      reloadingTipsRef.current = false;
    }
  }, [recordedTipsKeyRef, refreshGraphWindow, reloadingTipsRef, scopeTipsKeyRef, setPageError]);

  useEffect(() => {
    // A successful reload outside the tips loop advances the recorded key without changing the
    // apply effect's dependencies. Reset the round bound before that effect runs so the next tip is
    // loaded automatically again; the loop's own attempts are excluded by the key it recorded on
    // exit.
    const recorded = recordedTipsKeyRef.current;

    if (recorded === previousRecordedKeyRef.current) {
      return;
    }

    if (!reloadingTipsRef.current && recorded !== loopRecordedKeyRef.current) {
      roundsRef.current = 0;
    }

    previousRecordedKeyRef.current = recorded;
  });

  useEffect(() => {
    // Reading the tick documents that a re-armed loop requests another effect pass.
    void reArmTick;

    applyTipsEffect({
      contextRef,
      paginator,
      pagesLoaded,
      recordedTipsKeyRef,
      reloadForTips,
      reloadingTipsRef,
      roundsRef,
      scopeTipsKey,
      searchOpen,
      tipsPaginatorRef,
    });
  }, [
    pagesLoaded,
    paginator,
    reArmTick,
    recordedTipsKeyRef,
    reloadForTips,
    reloadingTipsRef,
    scopeTipsKey,
    searchOpen,
    tipsPaginatorRef,
  ]);
}

/**
 * Applies one tips effect pass.
 *
 * A fresh page, a closed search, or a new paginator starts a new convergence sequence and resets the
 * round bound. A recorded key ends the sequence, and an idle surface starts the bounded loop while
 * the bound allows another round.
 *
 * @param input - Current context and the reload bookkeeping.
 */
function applyTipsEffect(input: TipsEffectInput): void {
  const context: TipsEffectContext = {
    paginator: input.paginator,
    pagesLoaded: input.pagesLoaded,
    searchOpen: input.searchOpen,
  };

  if (!isSameTipsContext(input.contextRef.current, context)) {
    input.roundsRef.current = 0;
  }

  input.contextRef.current = context;

  if (input.tipsPaginatorRef.current !== input.paginator) {
    input.tipsPaginatorRef.current = input.paginator;
    input.recordedTipsKeyRef.current = input.scopeTipsKey;
    input.reloadingTipsRef.current = false;

    return;
  }

  if (input.scopeTipsKey === input.recordedTipsKeyRef.current) {
    input.roundsRef.current = 0;

    return;
  }

  startTipsReload(input);
}

/**
 * Reports whether two effect contexts describe the same convergence trigger.
 *
 * @param previous - Context of the previous pass.
 * @param next - Context of the current pass.
 * @returns True when no fresh trigger occurred.
 */
function isSameTipsContext(previous: TipsEffectContext, next: TipsEffectContext): boolean {
  return (
    previous.paginator === next.paginator &&
    previous.pagesLoaded === next.pagesLoaded &&
    previous.searchOpen === next.searchOpen
  );
}

/**
 * Starts the bounded reload loop when the surface is idle and the round bound allows it.
 *
 * @param input - Current context and the reload bookkeeping.
 */
function startTipsReload(input: TipsEffectInput): void {
  if (isTipsReloadBlocked(input)) {
    return;
  }

  if (input.roundsRef.current >= GRAPH_TIPS_RELOAD_ROUNDS) {
    return;
  }

  input.roundsRef.current += 1;
  void input.reloadForTips();
}

/**
 * Reports whether a page load, search, or the reload loop currently owns the surface.
 *
 * @param input - Current context and the reload bookkeeping.
 * @returns True when no new loop may start.
 */
function isTipsReloadBlocked(input: TipsEffectInput): boolean {
  return input.pagesLoaded === 0 || input.searchOpen || input.reloadingTipsRef.current;
}
