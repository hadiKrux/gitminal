import { useContext } from "react";
import { RepositoryContext } from "@/app/providers/RepositoryProvider";
import type { RepositoryContextValue } from "@/app/providers/RepositoryProvider.types";

/**
 * Reads the repository context when a provider is mounted, otherwise null.
 *
 * Shell surfaces such as the footer render in tests and in early provider states where the
 * repository provider may be absent. They use this hook to filter remote hints by real availability
 * when the provider exists and fall back to handler presence when it does not, without forcing every
 * shell test to mount the repository stack.
 *
 * @returns The repository context value, or null outside a `RepositoryProvider`.
 */
export function useOptionalRepository(): RepositoryContextValue | null {
  return useContext(RepositoryContext);
}
