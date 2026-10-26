import { useEffect, useState } from "react";
import type { BranchRiskRead } from "@/domain/repository/repository.types";
import type { BranchRiskState } from "@/features/branches/DeleteBranchModal.types";

/**
 * Reads the at-risk commits for one branch when the modal opens.
 *
 * The read runs for every branch, not only the ones a snapshot used to mark unmerged, because merge
 * state is now derived by this read. A failure is kept as an unknown merge state with its message
 * instead of being treated as merged or as an empty list. The effect ignores a settled read after
 * the modal unmounts or the branch changes.
 *
 * @param branchName - Branch being deleted.
 * @param readBranchRisk - Provider operation that resolves the base and performs the read.
 * @returns The loading or ready at-risk state.
 */
export function useDeleteBranchRisk(
  branchName: string,
  readBranchRisk: (name: string) => Promise<BranchRiskRead>,
): BranchRiskState {
  const [risk, setRisk] = useState<BranchRiskState>({ status: "loading" });

  useEffect(() => {
    let active = true;

    setRisk({ status: "loading" });

    readBranchRisk(branchName)
      .then((read) => {
        if (active) {
          setRisk({
            status: "ready",
            commits: read.commits,
            merged: read.merged,
            hasMore: read.hasMore,
            error: read.error,
          });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setRisk({
            status: "ready",
            commits: [],
            merged: null,
            hasMore: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

    return () => {
      active = false;
    };
  }, [branchName, readBranchRisk]);

  return risk;
}
