import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
  RepositoryRefreshResult,
  RepositoryStore,
} from "@/app/providers/RepositoryProvider.types";
import type { GitClient } from "@/domain/git/git.types";
import type { UpstreamEvidence } from "@/domain/repository/repository.types";

/** Inputs accepted by `useRepositoryRefreshCycle`. */
export interface RepositoryRefreshCycleInput {
  /** Launch directory. */
  readonly cwd: string;
  /** Git client built from `config.git.path`. */
  readonly client: GitClient;
  /** Clock used for read timestamps. */
  readonly now: () => number;
  /** Store writer. */
  readonly setStore: Dispatch<SetStateAction<RepositoryStore>>;
  /** False after unmount, so no read applies state then. */
  readonly mountedRef: MutableRefObject<boolean>;
  /** Shared upstream deletion and failure evidence. */
  readonly evidenceRef: MutableRefObject<UpstreamEvidence>;
}

/** Refresh operations exposed by `useRepositoryRefreshCycle`. */
export interface RepositoryRefreshCycle {
  /**
   * Reads status, then the graph window.
   *
   * @returns The refresh result.
   */
  refresh(): Promise<RepositoryRefreshResult>;
  /**
   * Reads status without history.
   *
   * @returns The refresh result.
   */
  refreshStatus(): Promise<RepositoryRefreshResult>;
  /**
   * Bumps the graph generation and awaits the registered window reloader.
   *
   * @returns The refresh result.
   */
  refreshGraphWindow(): Promise<RepositoryRefreshResult>;
  /**
   * Registers the graph feature's loaded-window reloader.
   *
   * @param refresher - Reloader, or null to clear it.
   */
  registerGraphWindowRefresher(refresher: (() => Promise<void>) | null): void;
}
