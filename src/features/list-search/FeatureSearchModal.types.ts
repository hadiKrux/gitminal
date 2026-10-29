/** One immutable searchable sidebar row. */
export interface FeatureSearchItem {
  /** Stable sidebar cursor identity. */
  readonly id: string;
  /** Full disambiguated name displayed without abbreviation. */
  readonly name: string;
  /** Optional display-only state marker; excluded from searchable name/details and stable identity. */
  readonly marker?: string;
  /** Additional searchable context. */
  readonly details: string;
}

/** Search overlay boundary; accepting reveals a row, never activates it. */
export interface FeatureSearchModalProps {
  /** Owning sidebar region. */
  readonly region: "remotes" | "tags" | "stashes" | "worktrees";
  /** Cursor captured before opening. */
  readonly selectedId: string | null;
  /** Requests a sidebar reveal after closing. */
  readonly onSelect: (id: string) => void;
  /** Closes with an optional post-focus-restore callback. */
  readonly onClose: (afterRestore?: () => void) => void;
}
