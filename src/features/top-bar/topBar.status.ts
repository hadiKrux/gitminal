import type { StatusKind } from "@/app/hooks/useStatus";
import type { RepositoryView } from "@/domain/repository/repository.types";
import type { TopBarStatusMode } from "@/features/top-bar/useTopBar.types";

/** Repository primary states that need no extra state label while idle. */
const QUIET_PRIMARY_STATES: ReadonlySet<string> = new Set(["normal", "subdirectory"]);

/**
 * Primary states with no usable branch or sync relationship.
 *
 * These states settle without a repository snapshot, so the strip renders the state label alone
 * instead of a fake `loading` branch or a zero-count sync badge.
 */
const BRANCHLESS_PRIMARY_STATES: ReadonlySet<string> = new Set([
  "not-a-repository",
  "bare",
  "missing-git",
  "permission-error",
]);

/**
 * Selects the single status-strip mode with the documented precedence.
 *
 * A running operation wins over any message, and a message wins over idle branch information. The
 * timeout that clears success and information messages belongs to `StatusProvider`, so this pure
 * projection never resets a message's lifetime on re-render. A failed first read is folded into the
 * idle mode so it replaces "loading repository" instead of waiting for an operation or message.
 *
 * @param input - Running operation, transient status, repository view, and last refresh error.
 * @returns The mode the strip renders.
 */
export function readTopBarStatusMode(input: {
  readonly operation: {
    readonly label: string;
    readonly phase: string;
    readonly percent: number | null;
  } | null;
  readonly status: { readonly kind: StatusKind; readonly message: string } | null;
  readonly view: RepositoryView;
  readonly lastRefreshError: string | null;
}): TopBarStatusMode {
  if (input.operation !== null) {
    return {
      kind: "operation",
      label: input.operation.label,
      phase: input.operation.phase,
      percent: input.operation.percent,
    };
  }

  if (input.status !== null) {
    return { kind: "status", statusKind: input.status.kind, message: input.status.message };
  }

  return readIdleStatus(input.view, input.lastRefreshError);
}

/**
 * Builds the idle branch-info mode from the repository view.
 *
 * @param view - Derived repository view.
 * @param lastRefreshError - Redacted error from the last failed read, or null.
 * @returns The idle status mode.
 */
function readIdleStatus(view: RepositoryView, lastRefreshError: string | null): TopBarStatusMode {
  const hasUpstream = view.upstream.status !== "none";
  const gated = BRANCHLESS_PRIMARY_STATES.has(view.state.primary);

  return {
    kind: "idle",
    loading: view.loading,
    initialError: view.loading ? lastRefreshError : null,
    gated,
    branchLabel: gated ? "" : view.branch.label,
    detached: view.branch.detached,
    upstreamLabel: hasUpstream && !gated ? view.upstream.label : null,
    upstreamMissing: view.upstream.indicatesMissing,
    ahead: gated ? 0 : view.ahead,
    behind: gated ? 0 : view.behind,
    sync: view.sync,
    stateLabel: QUIET_PRIMARY_STATES.has(view.state.primary) ? null : view.state.label,
  };
}
