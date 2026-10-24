import type { MutableRefObject } from "react";
import type {
  RepositoryRefreshResult,
  RepositoryStore,
} from "@/app/providers/RepositoryProvider.types";

/** Inputs accepted by `useRepositoryInitialRead`. */
export interface RepositoryInitialReadInput {
  /** Full refresh entry point. */
  readonly refresh: () => Promise<RepositoryRefreshResult>;
  /** False after unmount. */
  readonly mountedRef: MutableRefObject<boolean>;
  /** Latest store, used to skip focus refresh before the first read. */
  readonly storeRef: MutableRefObject<RepositoryStore>;
}
