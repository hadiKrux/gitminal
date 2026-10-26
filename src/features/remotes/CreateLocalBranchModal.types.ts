/** Draft values a valid create-local-branch submit reports to the owning panel. */
export interface CreateLocalBranchValues {
  /** Local branch name, already trimmed. */
  readonly name: string;
  /** Whether the new branch is checked out atomically. */
  readonly checkout: boolean;
}
