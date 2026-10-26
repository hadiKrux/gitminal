import type { ReactNode } from "react";
import type { useRepository } from "@/app/hooks/useRepository";
import type { StashRecord } from "@/domain/git/git.types";
import type { RepositorySnapshot } from "@/domain/repository/repository.types";
import type { CreateStashModalProps } from "@/features/stashes/CreateStashModal.types";

/** One pending created-stash selection request. */
export interface PendingStashCreation {
  /** Message submitted for the created stash. */
  readonly message: string;
  /** Snapshot that existed when the command was submitted. */
  readonly snapshot: RepositorySnapshot | null;
  /** Stash count read when the command was submitted. */
  readonly previousCount: number;
}

/** Shape of the repository context used by the pure stashes helpers. */
export type RepositoryReader = ReturnType<typeof useRepository>;

/** Inputs the panel supplies to the Delete Stash modal renderer. */
export interface DeleteStashModalInput {
  /** Stash opened for deletion. */
  readonly stash: StashRecord;
  /** Overlay close callback. */
  readonly onClose: () => void;
  /** Drops the stash by its immutable object name. */
  readonly onDrop: (objectName: string) => void;
}

/** Renderer callbacks the panel supplies to `useStashes`. */
export interface UseStashesOptions {
  /** Renders the Create Stash modal for one overlay entry. */
  readonly renderCreateStashModal: (input: CreateStashModalProps) => ReactNode;
  /** Renders the Delete Stash modal for one overlay entry. */
  readonly renderDeleteStashModal: (input: DeleteStashModalInput) => ReactNode;
}
