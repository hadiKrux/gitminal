import { useCallback, useMemo, useRef, useState } from "react";
import { readLogPage } from "@/domain/git/git.log";
import type { GitClient } from "@/domain/git/git.types";
import { createGraphPaginator } from "@/domain/graph/graph.paginate";
import type {
  GraphPage,
  GraphPageRequest,
  GraphScope,
  GraphWindowState,
} from "@/domain/graph/graph.types";
import { GRAPH_LOAD_ERROR_MESSAGE } from "@/features/graph/graph.constants";
import type { GraphWalkError } from "@/features/graph/graph.types";

/**
 * Owns the graph paginator and the React mirror of its window and load state.
 *
 * The paginator is rebuilt when the client, root, page size, or scope changes, which is exactly when
 * a new history read belongs to a different window. The scope-tip callback is passed through a ref
 * so the paginator reads the latest snapshot without rebuilding, and therefore without dropping
 * loaded pages, whenever the repository snapshot changes; it only seeds the cursor before the first
 * page. A tip that appears after the window started is handled by `useCommitGraph` reloading the
 * window through the provider. This hook keeps every state value and setter in one place so
 * `useGraphPaging` stays pure orchestration.
 *
 * @param input - Git client, root, page size, configured scope, and scope-tip reader.
 * @returns The paginator plus the window and load state with its setters.
 */
export function useGraphWindow(input: {
  readonly client: GitClient;
  readonly cwd: string;
  readonly pageSize: number;
  readonly scopeKey: GraphScope;
  readonly listScopeTips: () => readonly string[];
}) {
  const { client, cwd, pageSize, scopeKey } = input;
  const scopeTipsRef = useRef(input.listScopeTips);

  scopeTipsRef.current = input.listScopeTips;

  const readScopeTips = useCallback(() => scopeTipsRef.current(), []);
  const [windowState, setWindowState] = useState<GraphWindowState>(() => ({
    scopeKey,
    rows: [],
    pagesLoaded: 0,
    oldestOid: null,
    frontier: [],
    done: false,
  }));
  const [isLoadingInitial, setIsLoadingInitial] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [isLoadingParent, setIsLoadingParent] = useState(false);
  const [boundedMiss, setBoundedMiss] = useState(false);
  const [walkError, setWalkError] = useState<GraphWalkError | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const paginator = useMemo(
    () =>
      createGraphPaginator({
        pageSize,
        initialScope: scopeKey,
        listScopeTips: readScopeTips,
        loadPage: (request) => loadGraphPage(client, cwd, scopeKey, request),
      }),
    [client, cwd, pageSize, readScopeTips, scopeKey],
  );

  return {
    paginator,
    windowState,
    setWindowState,
    isLoadingInitial,
    setIsLoadingInitial,
    isLoadingOlder,
    setIsLoadingOlder,
    isLoadingParent,
    setIsLoadingParent,
    boundedMiss,
    setBoundedMiss,
    walkError,
    setWalkError,
    pageError,
    setPageError,
  };
}

/**
 * Loads one bounded graph page and maps it into the engine page shape.
 *
 * @param client - Git client bound to the configured executable.
 * @param cwd - Repository working directory.
 * @param scope - Configured graph scope.
 * @param request - Page size and cursor frontier.
 * @returns The parsed page.
 * @throws When git or the parser reports a classified failure.
 */
async function loadGraphPage(
  client: GitClient,
  cwd: string,
  scope: GraphScope,
  request: GraphPageRequest,
): Promise<GraphPage> {
  const controller = new AbortController();
  const result = await readLogPage(client, {
    cwd,
    signal: controller.signal,
    scope,
    limit: request.limit,
    frontier: request.frontier,
  });

  if (!result.ok) {
    throw new Error(result.failure?.message ?? GRAPH_LOAD_ERROR_MESSAGE);
  }

  return {
    commits: result.rows.map((row) => ({ oid: row.oid, parents: row.parents, row })),
    done: result.done,
  };
}
