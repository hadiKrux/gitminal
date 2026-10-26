import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
  RepositoryRefreshOptions,
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
   * @param options - Optional follow-up rule for a command-triggered refresh.
   * @returns The refresh result.
   */
  refresh(options?: RepositoryRefreshOptions): Promise<RepositoryRefreshResult>;
  /**
   * Reads status without history.
   *
   * @param options - Optional follow-up rule for a command-triggered refresh.
   * @returns The refresh result.
   */
  refreshStatus(options?: RepositoryRefreshOptions): Promise<RepositoryRefreshResult>;
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

/** Store flag that one coalescing task owns while it is in flight. */
export type RepositoryRefreshFlag = "statusInFlight" | "graphInFlight" | "refreshing";

/** Inputs accepted by `useRefreshFlagTask`. */
export interface RefreshFlagTaskInput {
  /** Store flag to raise while the task is in flight. */
  readonly flag: RepositoryRefreshFlag;
  /** Store writer. */
  readonly setStore: Dispatch<SetStateAction<RepositoryStore>>;
  /** False after unmount, so no flag is written then. */
  readonly mountedRef: MutableRefObject<boolean>;
}

/** Refs shared by the refresh tasks and operations. */
export interface RepositoryRefreshRefs {
  /** Last generation reserved by any read. */
  readonly generationRef: MutableRefObject<number>;
  /** Registered graph-window reloader, or null. */
  readonly graphRefresherRef: MutableRefObject<(() => Promise<void>) | null>;
  /** Controller of the last status read. */
  readonly readControllerRef: MutableRefObject<AbortController | null>;
  /** Controller of the queued follow-up read, or null when no follow-up is queued. */
  readonly followUpControllerRef: MutableRefObject<AbortController | null>;
  /** Queued status follow-up, or null. */
  readonly followUpStatusRef: MutableRefObject<Promise<RepositoryRefreshResult> | null>;
  /** Queued combined follow-up, or null. */
  readonly followUpCombinedRef: MutableRefObject<Promise<RepositoryRefreshResult> | null>;
}
