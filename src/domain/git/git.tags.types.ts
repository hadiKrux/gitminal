import type { RemoteTagCheckStatus } from "@/domain/repository/repository.types";

/** One remote's last known tag set, as consumed by the scope merge. */
export interface RemoteTagCheckInput {
  /** Tag names the last successful read advertises, or empty when none is known. */
  readonly names: readonly string[];
  /** Whether that set is known, never read, or the latest attempt failed. */
  readonly status: RemoteTagCheckStatus;
}

/** One numeric or non-numeric run of a tag name. */
export interface TagNameRun {
  /** True when the run is numeric and compares by value. */
  readonly numeric: boolean;
  /** Run text. */
  readonly value: string;
}
