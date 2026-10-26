/** Options accepted by `writeConfigAtomically`. */
export interface ConfigAtomicWriteOptions {
  /**
   * Rename override used by tests; defaults to `fs/promises`.
   *
   * It receives the sibling temp path and the target path, and a thrown error must leave the
   * previous file untouched.
   */
  readonly renameFile?: (source: string, destination: string) => Promise<void>;
}
