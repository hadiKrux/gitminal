import type { ReactNode } from "react";

/**
 * Value exposed by `DraftProvider` and read through `useDraft`.
 *
 * The draft is the single owner of the composer message. The composer writes it and the shell's
 * quit confirmation reads `hasUnsavedDraft`, so neither surface keeps a second copy.
 */
export interface DraftContextValue {
  /** Current composer draft, exactly as the textarea holds it. */
  readonly draft: string;
  /** True when the draft contains any non-whitespace text. */
  readonly hasUnsavedDraft: boolean;
  /**
   * Replaces the draft.
   *
   * @param draft - New draft text.
   */
  setDraft(draft: string): void;
  /** Clears the draft after a successful commit or amend. */
  clearDraft(): void;
}

/** Props accepted by `DraftProvider`. */
export interface DraftProviderProps {
  /** Provider content. */
  readonly children?: ReactNode;
  /** Initial draft, used by tests and by a future restored session. */
  readonly initialDraft?: string;
}
