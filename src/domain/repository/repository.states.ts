import { isSamePath } from "@/lib/paths";
import type {
  RepositoryFlag,
  RepositoryGateReason,
  RepositoryGateResult,
  RepositoryGateRule,
  RepositoryPrimaryState,
  RepositorySignals,
  RepositoryStateSnapshot,
} from "./repository.types";

/** Default signals before the first repository read settles. */
const BASE_SIGNALS: RepositorySignals = Object.freeze({
  cwd: "",
  loaded: false,
  gitAvailable: true,
  insideWorkTree: false,
  bare: false,
  repositoryRoot: null,
  gitDir: null,
  headExists: false,
  branch: null,
  detached: false,
  shortHash: null,
  remotes: Object.freeze([]),
  upstream: null,
  upstreamExists: false,
  upstreamCheck: "none",
  hasUpstreamBranches: true,
  mergeInProgress: false,
  rebaseInProgress: false,
  cherryPickInProgress: false,
  conflictedPaths: Object.freeze([]),
  stagedCount: 0,
  unstagedCount: 0,
  untrackedCount: 0,
  identity: Object.freeze({ name: null, email: null }),
  permissionError: false,
  notARepository: false,
  operationRunning: false,
  externalChanges: false,
  hugeRepository: false,
  binaryOrOversized: false,
  checkoutDirty: false,
  hookFailure: false,
  authNetworkFailure: false,
  invalidConfig: false,
  invalidTheme: false,
});

/** Primary state to the repository-wide reason it blocks with. */
const PRIMARY_GATE_REASONS: Partial<Record<RepositoryPrimaryState, RepositoryGateReason>> =
  Object.freeze({
    loading: "loading",
    "not-a-repository": "not-a-repository",
    bare: "bare-repository",
    "missing-git": "git-missing",
    "permission-error": "permission-error",
  });

/** Actions that are not repository actions and stay available in every primary state. */
const ALWAYS_AVAILABLE_ACTIONS: ReadonlySet<string> = new Set([
  "app.quit",
  "app.help",
  "app.palette",
  "app.console",
  "app.refresh",
  "app.reloadConfig",
  "app.themePicker",
  "overlay.close",
  "form.submit",
  "list.filter",
  "help.search",
  "console.clear",
  "diff.toggle",
  "remote.more",
  "commit.focus",
]);

/** Action prefixes that are navigation-only and stay available in every primary state. */
const ALWAYS_AVAILABLE_PREFIXES: readonly string[] = Object.freeze(["focus.", "nav."]);

/** Actions blocked while a mutation is running. */
const OPERATION_SAFE_ACTIONS: ReadonlySet<string> = new Set([
  "app.quit",
  "app.help",
  "app.palette",
  "app.console",
  "app.reloadConfig",
  "app.themePicker",
  "app.refresh",
  "overlay.close",
  "list.filter",
  "help.search",
  "console.clear",
  "graph.search",
  "diff.toggle",
]);

/** Action prefixes that stay available while a mutation is running. */
const OPERATION_SAFE_PREFIXES: readonly string[] = Object.freeze(["focus.", "nav."]);

/** Actions that need at least one commit on the current history. */
const EMPTY_REPOSITORY_ACTIONS: ReadonlySet<string> = new Set([
  "branch.create",
  "branch.delete",
  "tag.create",
  "tag.push",
  "tag.delete",
  "stash.create",
  "graph.search",
  "remote.push",
  "remote.pushForceSafe",
  "remote.pushForceOverwrite",
  "remote.pushNoVerify",
]);

/** Actions that need a branch HEAD. */
const DETACHED_HEAD_ACTIONS: ReadonlySet<string> = new Set([
  "remote.pull",
  "remote.push",
  "remote.pushForceSafe",
  "remote.pushForceOverwrite",
  "remote.pushNoVerify",
  "branch.delete",
]);

/** Actions that need at least one configured remote. */
const NO_REMOTE_ACTIONS: ReadonlySet<string> = new Set([
  "remote.pull",
  "remote.push",
  "remote.pushForceSafe",
  "remote.pushForceOverwrite",
  "remote.pushNoVerify",
  "remote.fetch",
  "remote.fetchPrune",
]);

/** Actions that need a configured upstream. */
const NO_UPSTREAM_ACTIONS: ReadonlySet<string> = new Set([
  "remote.pull",
  "remote.pushForceSafe",
  "remote.pushForceOverwrite",
]);

/** Actions whose scope is the upstream refs of local branches. */
const LOCAL_UPSTREAM_SCOPE_ACTIONS: ReadonlySet<string> = new Set(["remote.fetchPrune"]);

/** Actions blocked when the configured upstream is confirmed gone. */
const UPSTREAM_GONE_ACTIONS: ReadonlySet<string> = new Set([
  "remote.pull",
  "remote.pushForceSafe",
  "remote.pushForceOverwrite",
]);

/** Bulk index actions blocked while a merge, rebase, or cherry-pick is in progress. */
const OPERATION_MARKER_ACTIONS: ReadonlySet<string> = new Set(["diff.stageAll", "diff.unstageAll"]);

/** Actions blocked without a configured commit identity. */
const IDENTITY_ACTIONS: ReadonlySet<string> = new Set([
  "commit.submit",
  "commit.submitNoVerify",
  "commit.amend",
  "commit.amendNoVerify",
]);

/** The always-available result reused by the gate. */
const AVAILABLE_RESULT: RepositoryGateResult = Object.freeze({ available: true });

/**
 * Builds a complete signal set from the defaults plus overrides.
 *
 * Tests and the repository provider use this so adding a signal never breaks every caller. The
 * default is a not-yet-loaded signal set, so detection reports `loading` until a read fills it.
 *
 * @param overrides - Signal values to apply on top of the defaults.
 * @returns A frozen signal set.
 */
export function createRepositorySignals(
  overrides: Partial<RepositorySignals> = {},
): RepositorySignals {
  return Object.freeze({ ...BASE_SIGNALS, ...overrides });
}

/**
 * Detects the exclusive repository state and the ordered active flags.
 *
 * The function is pure and table-driven over the F-16 rows. Primary states are checked in a fixed
 * order: not loaded, git missing, not a repository, permission error, bare, empty, then normal or
 * subdirectory. Flags are only reported for a readable repository and always in the documented
 * order, so two snapshots with the same signals produce the same list.
 *
 * @param signals - Raw repository signals.
 * @returns The exclusive primary state plus ordered active flags.
 */
export function detectRepositoryState(signals: RepositorySignals): RepositoryStateSnapshot {
  const primary = readPrimaryState(signals);

  if (isGatingPrimary(primary)) {
    return { primary, flags: readEnvironmentFlags(signals) };
  }

  return { primary, flags: collectFlags(signals) };
}

/**
 * Reads the exclusive primary state.
 *
 * @param signals - Raw repository signals.
 * @returns The exclusive state for the whole shell.
 */
function readPrimaryState(signals: RepositorySignals): RepositoryPrimaryState {
  if (!signals.loaded) {
    return "loading";
  }

  if (!signals.gitAvailable) {
    return "missing-git";
  }

  if (signals.notARepository) {
    return "not-a-repository";
  }

  if (signals.permissionError) {
    return "permission-error";
  }

  if (signals.bare) {
    return "bare";
  }

  if (!signals.headExists) {
    return "empty";
  }

  return isSubdirectoryLaunch(signals) ? "subdirectory" : "normal";
}

/**
 * Reports whether a primary state replaces the whole shell.
 *
 * @param primary - Detected primary state.
 * @returns True for states that gate every repository action.
 */
function isGatingPrimary(primary: RepositoryPrimaryState): boolean {
  return (
    primary === "loading" ||
    primary === "not-a-repository" ||
    primary === "bare" ||
    primary === "missing-git" ||
    primary === "permission-error"
  );
}

/**
 * Reports whether the app was launched below the repository root.
 *
 * @param signals - Raw repository signals.
 * @returns True when the working directory differs from the work-tree root.
 */
function isSubdirectoryLaunch(signals: RepositorySignals): boolean {
  if (signals.repositoryRoot === null || signals.cwd.length === 0) {
    return false;
  }

  return !isSamePath(signals.cwd, signals.repositoryRoot);
}

/**
 * Collects the flags that still apply when the shell is gated by a primary state.
 *
 * @param signals - Raw repository signals.
 * @returns Configuration flags that explain a degraded but running shell.
 */
function readEnvironmentFlags(signals: RepositorySignals): RepositoryFlag[] {
  const flags: RepositoryFlag[] = [];

  if (signals.operationRunning) {
    flags.push("operation-in-progress");
  }

  if (signals.invalidConfig) {
    flags.push("invalid-config");
  }

  if (signals.invalidTheme) {
    flags.push("invalid-theme");
  }

  return flags;
}

/**
 * Collects every active flag for a readable repository in documented order.
 *
 * @param signals - Raw repository signals.
 * @returns Active flags in ticket 16 order.
 */
function collectFlags(signals: RepositorySignals): RepositoryFlag[] {
  return [
    ...collectHeadFlags(signals),
    ...collectRemoteFlags(signals),
    ...collectOperationFlags(signals),
    ...collectWorkingTreeFlags(signals),
    ...collectHealthFlags(signals),
  ];
}

/**
 * Collects HEAD-dependent flags.
 *
 * @param signals - Raw repository signals.
 * @returns Detached, no-upstream, and upstream-gone flags.
 */
function collectHeadFlags(signals: RepositorySignals): RepositoryFlag[] {
  const flags: RepositoryFlag[] = [];

  if (signals.detached) {
    flags.push("detached");
  }

  if (signals.headExists && signals.upstream === null) {
    flags.push("no-upstream");
  }

  if (signals.upstream !== null && !signals.upstreamExists && signals.upstreamCheck === "checked") {
    flags.push("upstream-gone");
  }

  return flags;
}

/**
 * Collects remote configuration flags.
 *
 * @param signals - Raw repository signals.
 * @returns No-remote or no-origin.
 */
function collectRemoteFlags(signals: RepositorySignals): RepositoryFlag[] {
  if (signals.remotes.length === 0) {
    return ["no-remote"];
  }

  return signals.remotes.includes("origin") ? [] : ["no-origin"];
}

/**
 * Collects in-progress operation and conflict flags.
 *
 * @param signals - Raw repository signals.
 * @returns Operation markers, conflicts, and the write latch flag.
 */
function collectOperationFlags(signals: RepositorySignals): RepositoryFlag[] {
  const flags: RepositoryFlag[] = [];

  if (signals.mergeInProgress) {
    flags.push("merge-in-progress");
  }

  if (signals.rebaseInProgress) {
    flags.push("rebase-in-progress");
  }

  if (signals.cherryPickInProgress) {
    flags.push("cherry-pick-in-progress");
  }

  if (signals.conflictedPaths.length > 0) {
    flags.push("conflicted");
  }

  if (signals.operationRunning) {
    flags.push("operation-in-progress");
  }

  return flags;
}

/**
 * Collects working-tree and size flags.
 *
 * @param signals - Raw repository signals.
 * @returns Checkout, freshness, size, and diff-size flags.
 */
function collectWorkingTreeFlags(signals: RepositorySignals): RepositoryFlag[] {
  const flags: RepositoryFlag[] = [];

  if (signals.checkoutDirty) {
    flags.push("checkout-dirty");
  }

  if (signals.externalChanges) {
    flags.push("external-changes");
  }

  if (signals.hugeRepository) {
    flags.push("huge-repository");
  }

  if (signals.binaryOrOversized) {
    flags.push("binary-or-oversized");
  }

  return flags;
}

/**
 * Collects identity, failure, and configuration flags.
 *
 * @param signals - Raw repository signals.
 * @returns Health and configuration flags.
 */
function collectHealthFlags(signals: RepositorySignals): RepositoryFlag[] {
  const flags: RepositoryFlag[] = [];

  if (!hasCommitIdentity(signals)) {
    flags.push("missing-identity");
  }

  if (signals.hookFailure) {
    flags.push("hook-failure");
  }

  if (signals.authNetworkFailure) {
    flags.push("auth-network-failure");
  }

  if (signals.invalidConfig) {
    flags.push("invalid-config");
  }

  if (signals.invalidTheme) {
    flags.push("invalid-theme");
  }

  return flags;
}

/**
 * Reports whether both commit identity values are configured.
 *
 * @param signals - Raw repository signals.
 * @returns True when user name and email are both present.
 */
function hasCommitIdentity(signals: RepositorySignals): boolean {
  return signals.identity.name !== null && signals.identity.email !== null;
}

/** Ordered repository-wide gate rules for a readable repository. */
const GATE_RULES: readonly RepositoryGateRule[] = Object.freeze([
  {
    reason: "no-commits-yet",
    actions: EMPTY_REPOSITORY_ACTIONS,
    applies: (state) => state.primary === "empty",
  },
  {
    reason: "detached-head",
    actions: DETACHED_HEAD_ACTIONS,
    applies: (state) => hasRepositoryFlag(state, "detached"),
  },
  {
    reason: "no-remote",
    actions: NO_REMOTE_ACTIONS,
    applies: (state) => hasRepositoryFlag(state, "no-remote"),
  },
  {
    reason: "no-local-upstreams",
    actions: LOCAL_UPSTREAM_SCOPE_ACTIONS,
    applies: (_state, signals) => !signals.hasUpstreamBranches,
  },
  {
    reason: "no-upstream",
    actions: NO_UPSTREAM_ACTIONS,
    applies: (state) => hasRepositoryFlag(state, "no-upstream"),
  },
  {
    reason: "upstream-gone",
    actions: UPSTREAM_GONE_ACTIONS,
    applies: (state) => hasRepositoryFlag(state, "upstream-gone"),
  },
  {
    reason: "merge-in-progress",
    actions: OPERATION_MARKER_ACTIONS,
    applies: (state) => hasRepositoryFlag(state, "merge-in-progress"),
  },
  {
    reason: "rebase-in-progress",
    actions: OPERATION_MARKER_ACTIONS,
    applies: (state) => hasRepositoryFlag(state, "rebase-in-progress"),
  },
  {
    reason: "cherry-pick-in-progress",
    actions: OPERATION_MARKER_ACTIONS,
    applies: (state) => hasRepositoryFlag(state, "cherry-pick-in-progress"),
  },
  {
    reason: "missing-git-identity",
    actions: IDENTITY_ACTIONS,
    applies: (state) => hasRepositoryFlag(state, "missing-identity"),
  },
]);

/**
 * Gates an action on repository-wide state.
 *
 * Only repository-wide gates belong here: whole-shell states, empty history, detached HEAD, remote
 * and upstream availability, in-progress operations, missing identity, and the write latch. Target
 * validation stays in `commands.availability.ts`, which calls this function first. Actions that
 * never touch the repository, such as quit, help, palette, focus traversal, and navigation, stay
 * available in every state.
 *
 * @param actionId - Stable action or command id.
 * @param state - Detected state snapshot.
 * @param signals - Raw repository signals.
 * @returns Whether the action is available, with a machine-readable reason when it is not.
 */
export function gateRepository(
  actionId: string,
  state: RepositoryStateSnapshot,
  signals: RepositorySignals,
): RepositoryGateResult {
  if (isAlwaysAvailable(actionId)) {
    return AVAILABLE_RESULT;
  }

  const primaryReason = PRIMARY_GATE_REASONS[state.primary];

  if (primaryReason !== undefined) {
    return blocked(primaryReason);
  }

  if (isOperationRunning(state, signals) && !isOperationSafe(actionId)) {
    return blocked("operation-in-progress");
  }

  const rule = GATE_RULES.find(
    (candidate) => candidate.actions.has(actionId) && candidate.applies(state, signals),
  );

  return rule === undefined ? AVAILABLE_RESULT : blocked(rule.reason);
}

/**
 * Reports whether a flag is active.
 *
 * @param state - Detected state snapshot.
 * @param flag - Flag to test.
 * @returns True when the flag is present.
 */
function hasRepositoryFlag(state: RepositoryStateSnapshot, flag: RepositoryFlag): boolean {
  return state.flags.includes(flag);
}

/**
 * Reports whether an action never depends on repository state.
 *
 * @param actionId - Stable action or command id.
 * @returns True when the action stays available in every primary state.
 */
function isAlwaysAvailable(actionId: string): boolean {
  return (
    ALWAYS_AVAILABLE_ACTIONS.has(actionId) ||
    ALWAYS_AVAILABLE_PREFIXES.some((prefix) => actionId.startsWith(prefix))
  );
}

/**
 * Reports whether a mutation is currently running.
 *
 * @param state - Detected state snapshot.
 * @param signals - Raw repository signals.
 * @returns True when either source reports an operation in progress.
 */
function isOperationRunning(state: RepositoryStateSnapshot, signals: RepositorySignals): boolean {
  return signals.operationRunning || state.flags.includes("operation-in-progress");
}

/**
 * Reports whether an action may run while a mutation is in progress.
 *
 * @param actionId - Stable action or command id.
 * @returns True for reads, navigation, and quit paths.
 */
function isOperationSafe(actionId: string): boolean {
  return (
    OPERATION_SAFE_ACTIONS.has(actionId) ||
    OPERATION_SAFE_PREFIXES.some((prefix) => actionId.startsWith(prefix))
  );
}

/**
 * Reports whether a merge, rebase, or cherry-pick is in progress.
 *
 * Target-aware availability uses this for the conflict gates that ticket 16 assigns to the command
 * layer rather than to the repository-wide gate.
 *
 * @param state - Detected state snapshot.
 * @returns True when any operation marker is active.
 */
export function hasOperationMarker(state: RepositoryStateSnapshot): boolean {
  return (
    hasRepositoryFlag(state, "merge-in-progress") ||
    hasRepositoryFlag(state, "rebase-in-progress") ||
    hasRepositoryFlag(state, "cherry-pick-in-progress")
  );
}

/**
 * Builds a blocked gate result.
 *
 * @param reason - Machine-readable blocked reason.
 * @returns A frozen blocked result.
 */
function blocked(reason: RepositoryGateReason): RepositoryGateResult {
  return Object.freeze({ available: false, reason });
}
