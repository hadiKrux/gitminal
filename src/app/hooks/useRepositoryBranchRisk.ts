import { useCallback, useMemo } from "react";
import type {
  RepositoryBranchRisk,
  RepositoryBranchRiskInput,
} from "@/app/hooks/useRepositoryBranchRisk.types";
import { readBranchRisk, resolveBranchMergeTarget } from "@/domain/git/git.branches";
import type { BranchRecord } from "@/domain/git/git.types";
import type { BranchRiskRead, RepositorySnapshot } from "@/domain/repository/repository.types";

/**
 * Reads the commits an unmerged-branch acknowledgement has to name.
 *
 * The base is resolved from the latest snapshot at call time, so a branch whose upstream changed
 * since the modal opened is compared against the ref git would actually use. A configured upstream
 * counts only while its remote-tracking ref is present in the snapshot; otherwise HEAD is the base.
 * The read is a bounded local log through the shared client, and it never throws: a failure comes
 * back as an empty list with an unknown merge state and a message the caller renders beside the
 * acknowledgement.
 *
 * @param input - Client, launch directory, and store ref.
 * @returns The branch risk operation exposed by the provider.
 */
export function useRepositoryBranchRisk(input: RepositoryBranchRiskInput): RepositoryBranchRisk {
  const { client, cwd, storeRef } = input;

  /** Reads the at-risk commits of one branch from the current snapshot. */
  const readRisk = useCallback(
    async (name: string): Promise<BranchRiskRead> => {
      const snapshot = storeRef.current.snapshot;

      try {
        return await readBranchRisk(
          client,
          { cwd, signal: new AbortController().signal },
          { name, base: resolveBranchRiskBase(snapshot, name) },
        );
      } catch (error) {
        return {
          commits: [],
          merged: null,
          hasMore: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    [client, cwd, storeRef],
  );

  return useMemo(() => ({ readBranchRisk: readRisk }), [readRisk]);
}

/**
 * Resolves the base a branch is compared against from the latest snapshot.
 *
 * The branch record owns the configured upstream halves, which is the only unambiguous source. A
 * missing record falls back to the snapshot's current upstream when the name is the current branch,
 * because a failed branch list read must not silently compare against HEAD instead of the upstream.
 * The remote-tracking existence check lives in `resolveBranchMergeTarget`, so a configured upstream
 * whose ref is gone falls back to HEAD for both the merge state and the at-risk list.
 *
 * @param snapshot - Latest snapshot, or null before the first successful read.
 * @param name - Branch the caller asked about.
 * @returns The commit-ish used for the at-risk read.
 */
function resolveBranchRiskBase(snapshot: RepositorySnapshot | null, name: string): string {
  const branch: BranchRecord | null =
    snapshot?.branches.find((record) => record.name === name) ?? null;
  const fallbackUpstream =
    branch === null && snapshot !== null && snapshot.branch === name ? snapshot.upstream : null;

  return resolveBranchMergeTarget({
    branch,
    remoteBranches: snapshot?.remoteBranches ?? [],
    fallbackUpstream,
  });
}
