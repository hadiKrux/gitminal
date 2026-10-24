import type { MutableRefObject } from "react";
import type { RepositoryStore } from "@/app/providers/RepositoryProvider.types";

/** Inputs accepted by `useRepositoryAvailability`. */
export interface RepositoryAvailabilityInput {
  /** Latest store, read without re-rendering. */
  readonly storeRef: MutableRefObject<RepositoryStore>;
}
