import type { RemoteFetchScope } from "@/domain/config/config.types";
import { readUpstreamGroups } from "@/domain/git/git.remotes";
import type { RemoteFetchGroup } from "@/domain/git/git.remotes.types";
import type { CommandAvailabilityReason, CommandFormValues } from "./commands.types";

/** Form value carrying the effective `remote.fetchScope`. */
const FETCH_SCOPE_FORM_KEY = "fetchScope";

/** Form value carrying the checked-out branch the request was dispatched from. */
const FETCH_BRANCH_FORM_KEY = "branch";

/**
 * Builds the Fetch --prune form values shared by the top bar and the palette.
 *
 * The scope is captured from configuration when the request is dispatched, and the branch is
 * captured from the same provider projection the top bar renders. The executor reads both back, so
 * a palette request and a top-bar request reach the planner with identical values.
 *
 * @param scope - Effective `config.remote.fetchScope`.
 * @param branch - Checked-out branch name, or an empty string for a detached HEAD.
 * @returns The frozen form values for `remote.fetchPrune`.
 */
export function buildFetchFormValues(scope: RemoteFetchScope, branch: string): CommandFormValues {
  return Object.freeze({ [FETCH_SCOPE_FORM_KEY]: scope, [FETCH_BRANCH_FORM_KEY]: branch });
}

/**
 * Reads the effective fetch scope from a request.
 *
 * A missing or unrecognized value falls back to `local`, which is the documented default and the
 * behavior of a direct executor call that carries no form values.
 *
 * @param values - Request form values, when any.
 * @returns The requested scope.
 */
export function readFetchScope(values: CommandFormValues | undefined): RemoteFetchScope {
  return values?.[FETCH_SCOPE_FORM_KEY] === "current" ? "current" : "local";
}

/**
 * Reads the branch a fetch request was dispatched from.
 *
 * @param values - Request form values, when any.
 * @returns The branch name, or null when the request carries none.
 */
export function readFetchBranch(values: CommandFormValues | undefined): string | null {
  const value = values?.[FETCH_BRANCH_FORM_KEY];

  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Reads the upstream groups a fetch request is allowed to touch.
 *
 * `local` keeps every local branch upstream, which is the product default. `current` narrows the
 * read to the exact checked-out branch, so a request with no branch name yields no groups instead of
 * falling back to a wider scope.
 *
 * @param stdout - Captured `for-each-ref` output.
 * @param values - Request form values, when any.
 * @returns The in-scope remote groups.
 */
export function readScopedUpstreamGroups(
  stdout: string,
  values: CommandFormValues | undefined,
): readonly RemoteFetchGroup[] {
  if (readFetchScope(values) !== "current") {
    return readUpstreamGroups(stdout);
  }

  const branch = readFetchBranch(values);

  return branch === null ? [] : readUpstreamGroups(stdout, { localBranch: branch });
}

/**
 * Reads the blocked reason for a fetch request whose scope has no upstream refs.
 *
 * @param values - Request form values, when any.
 * @returns `no-current-upstream` for the current scope and `no-local-upstreams` otherwise.
 */
export function readEmptyFetchScopeReason(
  values: CommandFormValues | undefined,
): CommandAvailabilityReason {
  return readFetchScope(values) === "current" ? "no-current-upstream" : "no-local-upstreams";
}
