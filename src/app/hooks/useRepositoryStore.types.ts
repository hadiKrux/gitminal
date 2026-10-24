import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { RepositoryStore } from "@/app/providers/RepositoryProvider.types";
import type { RepositorySelection, UpstreamEvidence } from "@/domain/repository/repository.types";

/** Inputs accepted by `useRepositoryStore`. */
export interface RepositoryStoreInput {
  /** Launch directory. */
  readonly cwd: string;
  /** Initial right-pane selection. */
  readonly initialSelection?: RepositorySelection;
  /** Whether worktree watching is enabled. */
  readonly worktreeWatch: boolean;
}

/** Store handle shared by the provider hooks. */
export interface RepositoryStoreHandle {
  /** Current store. */
  readonly store: RepositoryStore;
  /** Store writer. */
  readonly setStore: Dispatch<SetStateAction<RepositoryStore>>;
  /** Latest store, readable from callbacks without re-rendering. */
  readonly storeRef: MutableRefObject<RepositoryStore>;
  /** False after unmount. */
  readonly mountedRef: MutableRefObject<boolean>;
  /** Upstream deletion and failure evidence for the session. */
  readonly evidenceRef: MutableRefObject<UpstreamEvidence>;
  /**
   * Replaces the right-pane selection.
   *
   * @param selection - New selection value.
   */
  setSelection(selection: RepositorySelection): void;
}
