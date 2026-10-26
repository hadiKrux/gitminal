import { readSearchPage } from "@/domain/git/git.log";
import type { GraphPage, GraphSearchRequest } from "@/domain/graph/graph.types";
import { GRAPH_SEARCH_ERROR_MESSAGE } from "@/features/graph/graph.constants";
import type { UseCommitSearchInput } from "@/features/graph/graph.types";

/**
 * Loads one bounded search page and maps it into the engine page shape.
 *
 * @param input - Search input carrying the client, working directory, and scope.
 * @param request - Terms, stable result offset, and page size.
 * @returns The parsed page.
 * @throws When git or the parser reports a classified failure.
 */
export async function loadSearchPage(
  input: {
    readonly client: UseCommitSearchInput["client"];
    readonly cwd: string;
    readonly scopeKey: UseCommitSearchInput["scopeKey"];
  },
  request: GraphSearchRequest,
): Promise<GraphPage> {
  const controller = new AbortController();
  const result = await readSearchPage(input.client, {
    cwd: input.cwd,
    signal: controller.signal,
    scope: input.scopeKey,
    terms: request.terms,
    limit: request.limit,
    offset: request.offset,
  });

  if (!result.ok) {
    throw new Error(result.failure?.message ?? GRAPH_SEARCH_ERROR_MESSAGE);
  }

  return {
    commits: result.rows.map((row) => ({ oid: row.oid, parents: row.parents, row })),
    done: result.done,
  };
}
