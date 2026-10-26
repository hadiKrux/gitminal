import type { DiffLoadState } from "@/domain/diff/diff.types";

/** Enqueues one serialized diff read behind every earlier read. */
export type DiffRequestEnqueue = (run: (signal: AbortSignal) => Promise<void>) => void;

/** A commit or stash selection resolved to its read request. */
export type ReadOnlyTarget =
  | { readonly kind: "commit"; readonly key: string; readonly oid: string }
  | { readonly kind: "stash"; readonly key: string; readonly selector: string | null };

/** State of the whole read-only file list. */
export interface ReadOnlyDiffState {
  /** Selection key the list belongs to, or null outside read-only mode. */
  readonly key: string | null;
  /** Load status of the list. */
  readonly status: "idle" | "loading" | "loaded" | "error";
  /** Parsed files with their collapsed segments, in patch order. */
  readonly files: readonly DiffLoadState[];
  /** Failure or notice text, or null. */
  readonly message: string | null;
}
