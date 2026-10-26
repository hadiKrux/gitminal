import type { MutableRefObject } from "react";
import type { RepositoryStore } from "@/app/providers/RepositoryProvider.types";
import type { GitClient } from "@/domain/git/git.types";
import type { BranchRiskRead } from "@/domain/repository/repository.types";

/** Inputs accepted by `useRepositoryBranchRisk`. */
export interface RepositoryBranchRiskInput {
  /** Git client built from `config.git.path`. */
  readonly client: GitClient;
  /** Launch directory; the git client runs from it. */
  readonly cwd: string;
  /** Latest store, read without re-rendering. */
  readonly storeRef: MutableRefObject<RepositoryStore>;
}

/** Branch risk operations exposed by the hook. */
export interface RepositoryBranchRisk {
  /**
   * Reads the capped commits a branch holds that its deletion base does not.
   *
   * @param name - Branch whose at-risk commits are read.
   * @returns The capped commit list plus any classified error.
   */
  readBranchRisk(name: string): Promise<BranchRiskRead>;
}
