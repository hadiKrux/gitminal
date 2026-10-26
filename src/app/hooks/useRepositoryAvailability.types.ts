import type { MutableRefObject } from "react";
import type { RepositoryStore } from "@/app/providers/RepositoryProvider.types";
import type { TagRowRecord } from "@/domain/git/git.types";
import type { RemoteTagChecks, RepositorySnapshot } from "@/domain/repository/repository.types";

/** Inputs accepted by `useRepositoryAvailability`. */
export interface RepositoryAvailabilityInput {
  /** Latest store, read without re-rendering. */
  readonly storeRef: MutableRefObject<RepositoryStore>;
}

/** Memoized tag rows for one snapshot and one remote tag knowledge value. */
export interface TagRowsCache {
  /** Snapshot the rows were derived from. */
  readonly snapshot: RepositorySnapshot | null;
  /** Remote tag knowledge the rows were derived from. */
  readonly checks: RemoteTagChecks;
  /** Derived rows. */
  readonly rows: readonly TagRowRecord[];
}
