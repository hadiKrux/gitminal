import { useMemo, useState } from "react";
import { useDebouncedValue } from "@/app/hooks/useDebouncedValue";
import type { GraphScope } from "@/domain/config/config.types";
import type { GitClient } from "@/domain/git/git.types";
import { createGraphSearch, parseSearchTerms } from "@/domain/graph/graph.search";
import { loadSearchPage } from "@/features/graph/commitSearch.load";
import { GRAPH_SEARCH_DEBOUNCE_MS } from "@/features/graph/graph.constants";

/**
 * Owns the raw search query, its debounce, the parsed terms, and the bounded search engine.
 *
 * The raw query drives highlighting immediately, while the debounced query drives the git read. The
 * engine is rebuilt only when the scope, page size, or repository binding changes, so an in-flight
 * read can still be discarded through its own generation.
 *
 * @param input - Scope, page size, client, and working directory.
 * @returns The raw and debounced query, parsed terms, highlight terms, and the engine.
 */
export function useSearchQuery(input: {
  readonly scopeKey: GraphScope;
  readonly pageSize: number;
  readonly client: GitClient;
  readonly cwd: string;
}) {
  const { client, cwd, pageSize, scopeKey } = input;
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, GRAPH_SEARCH_DEBOUNCE_MS);
  const parsed = useMemo(
    () => ({ terms: parseSearchTerms(debouncedQuery), highlight: parseSearchTerms(query) }),
    [debouncedQuery, query],
  );
  const engine = useMemo(
    () =>
      createGraphSearch({
        scopeKey,
        pageSize,
        loadPage: (request) => loadSearchPage({ client, cwd, scopeKey }, request),
      }),
    [client, cwd, pageSize, scopeKey],
  );

  return {
    query,
    setQuery,
    debouncedQuery,
    terms: parsed.terms,
    highlight: parsed.highlight,
    engine,
  };
}
