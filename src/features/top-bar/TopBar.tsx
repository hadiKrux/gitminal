import { TextAttributes } from "@opentui/core";
import type { ReactNode } from "react";
import { useRepository } from "@/app/hooks/useRepository";
import { type StatusKind, useStatus } from "@/app/hooks/useStatus";
import type { GitWatchStatus } from "@/domain/git/git.types";
import { selectRepositoryView } from "@/domain/repository/repository.selectors";
import type { ThemeTokens } from "@/domain/theme/theme.types";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";

/**
 * Renders the temporary M4 top bar with live repository and status text.
 *
 * This is a temporary placeholder that M5 replaces with the real top bar. It reads the repository
 * snapshot and status only; it owns no repository or status state. It is supplied to the shell by
 * the composition root, so no feature imports another feature.
 *
 * @returns The branch, upstream, ahead and behind, pending counts, repository state, watch hint,
 * and current status.
 */
export function TopBar(): ReactNode {
  const tokens = useTokens();
  const repository = useRepository();
  const { status, operation } = useStatus();
  const summary = readTopBarSummary(repository, status, operation, tokens);

  return (
    <>
      <text fg={tokens.text} wrapMode="none" flexShrink={0} attributes={TextAttributes.BOLD}>
        Gitminal
      </text>
      <text fg={tokens.muted} wrapMode="none" flexShrink={0}>
        {summary.branchText}
      </text>
      <text fg={tokens.muted} wrapMode="none" flexShrink={0}>
        {summary.upstreamText}
      </text>
      {summary.aheadText === null ? null : (
        <text fg={tokens.muted} wrapMode="none" flexShrink={0}>
          {summary.aheadText}
        </text>
      )}
      {summary.pendingText === null ? null : (
        <text fg={tokens.muted} wrapMode="none" flexShrink={0}>
          {summary.pendingText}
        </text>
      )}
      <text fg={tokens.dim} wrapMode="none" flexShrink={0}>
        {summary.stateText}
      </text>
      {summary.watchHintText === null ? null : (
        <text fg={tokens.dim} wrapMode="none" flexShrink={0}>
          {summary.watchHintText}
        </text>
      )}
      <box flexGrow={1} />
      <text fg={summary.color} wrapMode="none" flexShrink={0}>
        {summary.message}
      </text>
    </>
  );
}

/**
 * Derives every text run the temporary top bar renders.
 *
 * @param repository - Repository context value.
 * @param status - Transient status, or null.
 * @param operation - Running operation, or null.
 * @param tokens - Active theme tokens.
 * @returns The text runs and the status color.
 */
function readTopBarSummary(
  repository: ReturnType<typeof useRepository>,
  status: ReturnType<typeof useStatus>["status"],
  operation: ReturnType<typeof useStatus>["operation"],
  tokens: ThemeTokens,
) {
  const view = selectRepositoryView(
    repository.snapshot,
    repository.state,
    repository.upstreamStatus,
  );
  const workTreeReady = isWorkTreeReady(view);

  return {
    branchText: view.loading
      ? "  loading repository..."
      : `  ${formatBranch(view.branch.label, view.branch.detached)}`,
    upstreamText: `  ${readUpstreamLabel(view)}`,
    aheadText: workTreeReady ? `  ahead ${view.ahead} behind ${view.behind}` : null,
    pendingText: workTreeReady
      ? `  ${view.pending.staged} staged ${view.pending.unstaged} unstaged ${view.pending.untracked} untracked`
      : null,
    stateText: `  ${view.state.label}`,
    watchHintText: workTreeReady ? readWatchHintText(repository.watch) : null,
    message: readTopBarMessage(repository.lastRefreshError, status, operation),
    color: statusColor(status?.kind, tokens),
  };
}

/**
 * Reports whether the repository has a readable work tree to summarize.
 *
 * During loading and in the not-a-repository, bare, missing-git, and permission-error states there
 * is no work tree to count or watch, so the top bar omits the ahead/behind, pending, and watch-hint
 * runs instead of showing zero counts that read as a clean tree.
 *
 * @param view - Derived repository view.
 * @returns True for a loaded, readable work tree.
 */
function isWorkTreeReady(view: ReturnType<typeof selectRepositoryView>): boolean {
  if (view.loading) {
    return false;
  }

  return (
    view.state.primary === "normal" ||
    view.state.primary === "subdirectory" ||
    view.state.primary === "empty"
  );
}

/**
 * Reads the upstream text run.
 *
 * @param view - Derived repository view.
 * @returns The upstream label with its text marker when missing.
 */
function readUpstreamLabel(view: ReturnType<typeof selectRepositoryView>): string {
  return view.upstream.indicatesMissing
    ? `${ICONS.missingUpstream} ${view.upstream.label}`
    : view.upstream.label;
}

/**
 * Reads the status or progress text run.
 *
 * @param lastRefreshError - Last failed read message, or null.
 * @param status - Transient status, or null.
 * @param operation - Running operation, or null.
 * @returns The text shown at the right of the top bar.
 */
function readTopBarMessage(
  lastRefreshError: string | null,
  status: ReturnType<typeof useStatus>["status"],
  operation: ReturnType<typeof useStatus>["operation"],
): string {
  if (operation !== null) {
    return `${operation.phase}${operation.percent === null ? "" : ` ${Math.round(operation.percent)}%`}`;
  }

  return status?.message ?? lastRefreshError ?? "ready";
}

/**
 * Reads the watch hint text run.
 *
 * @param watch - Current watch status.
 * @returns The prefixed hint, or null when the working tree is watched at full capability.
 */
function readWatchHintText(watch: GitWatchStatus): string | null {
  const hint = readWatchHint(watch);

  return hint === null ? null : `  ${hint}`;
}

/**
 * Formats a branch label for the top bar.
 *
 * @param label - Branch name or detached short hash.
 * @param detached - True for a detached HEAD.
 * @returns The label with a text marker for detachment.
 */
function formatBranch(label: string, detached: boolean): string {
  return detached ? `${label} (detached)` : label;
}

/**
 * Reads the watch hint shown in the temporary top bar.
 *
 * The working tree is never watched in the default git-dir mode, so the hint is published whenever
 * the active mode is not `worktree`, in addition to any active watcher limitation. The text is kept
 * short so it fits the one-row status strip; it is text so color is never the only signal, and it
 * comes from provider watch state rather than a bespoke flag.
 *
 * @param watch - Current watch status.
 * @returns The hint text, or null when the working tree is watched at full capability.
 */
function readWatchHint(watch: GitWatchStatus): string | null {
  const base = watch.mode === "worktree" ? null : "unwatched tree; press r";

  if (watch.limitation === null) {
    return base;
  }

  if (base === null) {
    return watch.limitation;
  }

  return `${base}; ${watch.limitation}`;
}

/**
 * Maps a status severity to its theme color.
 *
 * @param kind - Status kind, or `undefined` when there is no message.
 * @param tokens - Active theme tokens.
 * @returns The color for the status strip text.
 */
function statusColor(kind: StatusKind | undefined, tokens: ThemeTokens): string {
  switch (kind) {
    case "success":
      return tokens.success;
    case "warning":
      return tokens.warning;
    case "error":
      return tokens.error;
    case "info":
      return tokens.info;
    default:
      return tokens.muted;
  }
}
