import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { RepositoryStore } from "@/app/providers/RepositoryProvider.types";
import type { GitClient } from "@/domain/git/git.types";

/** Inputs accepted by `useRepositoryRemoteTags`. */
export interface RepositoryRemoteTagsInput {
  /** Git client built from `config.git.path`. */
  readonly client: GitClient;
  /** Launch directory; the git client runs from it. */
  readonly cwd: string;
  /** Store writer for the tag knowledge. */
  readonly setStore: Dispatch<SetStateAction<RepositoryStore>>;
  /** Latest store, read without re-rendering. */
  readonly storeRef: MutableRefObject<RepositoryStore>;
  /** False after unmount; a settled read never writes then. */
  readonly mountedRef: MutableRefObject<boolean>;
  /** Clock used for the successful check timestamp. */
  readonly now: () => number;
}

/** Remote tag knowledge operations exposed by the hook. */
export interface RepositoryRemoteTags {
  /**
   * Re-reads every configured remote's advertised tags.
   *
   * @returns A promise that settles after every configured remote has been attempted.
   */
  refreshRemoteTags(): Promise<void>;
}
