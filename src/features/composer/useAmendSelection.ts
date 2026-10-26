import { useCallback, useEffect, useRef, useState } from "react";
import { useStatus } from "@/app/hooks/useStatus";
import type { GitClient } from "@/domain/git/git.types";
import { AMEND_READ_FAILED, readHeadCommit } from "./composer.amend";
import { COMMIT_VARIANTS } from "./composer.commands";
import type { ComposerMenuSession } from "./composer.types";

/**
 * Owns the amend menu session, the previous-message load, and the amend indicator.
 *
 * Selecting an amend variant loads HEAD's message and short hash once per menu session and writes
 * the message into the draft when it is empty. A direct `commit.amend` or `commit.amendNoVerify`
 * starts the same session itself, so every path loads the previous message, shows the indicator
 * before the write starts, and sends the same message. The short hash names the commit the amend
 * replaces and stays visible past the menu close while the write runs. Cancel, Esc, or any other
 * close except Run restores the pre-menu draft snapshot. A cancelled or superseded read is silent:
 * the user either cancelled or the Run path already awaited the read.
 *
 * @param input - Git client, working directory, draft reader and writer.
 * @returns The amend indicator plus the session, highlight, and preparation entry points.
 */
export function useAmendSelection(input: {
  readonly client: GitClient;
  readonly cwd: string;
  readonly readDraft: () => string;
  readonly writeDraft: (value: string) => void;
}) {
  const { client, cwd, readDraft, writeDraft } = input;
  const { setStatus } = useStatus();
  const [amendShortHash, setAmendShortHash] = useState<string | null>(null);
  const sessionRef = useRef<ComposerMenuSession | null>(null);
  const loadTokenRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const pendingLoadRef = useRef<Promise<boolean> | null>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  /** Clears the amend indicator after a successful write. */
  const clearAmendIndicator = useCallback((): void => {
    setAmendShortHash(null);
  }, []);

  /**
   * Starts one session with a snapshot of the current draft.
   *
   * @param snapshot - Draft captured when the session began.
   */
  const beginSession = useCallback((snapshot: string): void => {
    sessionRef.current = { snapshot, amendLoad: null };
    loadTokenRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    pendingLoadRef.current = null;
    setAmendShortHash(null);
  }, []);

  /**
   * Restores the pre-session draft snapshot and ends the session.
   *
   * @param restore - True to write the captured draft back.
   * @param keepAmendIndicator - True to keep the loaded short hash for the running write.
   */
  const closeSession = useCallback(
    (restore: boolean, keepAmendIndicator: boolean = false): void => {
      const session = sessionRef.current;

      if (session === null) {
        return;
      }

      sessionRef.current = null;
      loadTokenRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      pendingLoadRef.current = null;
      setAmendShortHash(keepAmendIndicator ? (session.amendLoad?.shortHash ?? null) : null);

      if (restore) {
        writeDraft(session.snapshot);
      }
    },
    [writeDraft],
  );

  /**
   * Applies the loaded amend short hash and the previous message to an empty draft.
   *
   * The live draft is read at apply time, not the session snapshot, so a message the user typed
   * after highlighting an amend variant is never overwritten when Run is pressed.
   *
   * @param loaded - Loaded message and short hash.
   */
  const applyAmendLoad = useCallback(
    (loaded: { readonly message: string; readonly shortHash: string }): void => {
      if (readDraft().trim().length === 0) {
        writeDraft(loaded.message);
      }

      setAmendShortHash(loaded.shortHash);
    },
    [readDraft, writeDraft],
  );

  /**
   * Runs one HEAD read for the current session and records its result.
   *
   * A stale token, a replaced session, or a cancelled read is silent. Only a settled read that still
   * belongs to the active session and failed for a real reason reports the warning.
   *
   * @param session - Session the read belongs to.
   * @returns True when the message and short hash are stored on the session.
   */
  const startLoad = useCallback(
    async (session: ComposerMenuSession): Promise<boolean> => {
      const controller = new AbortController();
      const token = loadTokenRef.current + 1;

      loadTokenRef.current = token;
      abortRef.current = controller;

      const read = await readHeadCommit(client, cwd, controller.signal);
      const stale = token !== loadTokenRef.current || sessionRef.current !== session;

      if (abortRef.current === controller) {
        abortRef.current = null;
      }

      if (stale) {
        return false;
      }

      if (!read.ok) {
        if (!read.cancelled) {
          setStatus({ kind: "warning", message: AMEND_READ_FAILED });
        }

        return false;
      }

      session.amendLoad = { message: read.message, shortHash: read.shortHash };

      return true;
    },
    [client, cwd, setStatus],
  );

  /**
   * Loads HEAD's message and short hash once for the current session.
   *
   * A load already in flight is awaited instead of replaced, so pressing Run during a highlight load
   * still waits for the message and the indicator rather than aborting them. The loaded values are
   * applied to the draft and indicator before the caller starts the write.
   *
   * @returns True when both reads succeeded and still belong to the active session.
   */
  const loadAmendCommit = useCallback(async (): Promise<boolean> => {
    const session = sessionRef.current;

    if (session === null) {
      return false;
    }

    if (session.amendLoad !== null) {
      applyAmendLoad(session.amendLoad);

      return true;
    }

    const pending = pendingLoadRef.current;

    if (pending !== null) {
      const loaded = await pending;

      if (loaded) {
        applyLoadedSession(sessionRef.current, applyAmendLoad);
      }

      return loaded;
    }

    const promise = startLoad(session);

    pendingLoadRef.current = promise;

    const loaded = await promise;

    if (pendingLoadRef.current === promise) {
      pendingLoadRef.current = null;
    }

    if (loaded) {
      applyLoadedSession(sessionRef.current, applyAmendLoad);
    }

    return loaded;
  }, [applyAmendLoad, startLoad]);

  /**
   * Ensures an amend session exists and loads HEAD for it.
   *
   * This is the single preparation path for the menu's Run button, a directly bound `commit.amend*`
   * action, and a palette dispatch. When no menu was opened, the current draft becomes the session
   * snapshot, so an empty composer receives the previous message and a typed draft is preserved.
   *
   * @param draft - Current draft used as the snapshot for a direct action.
   * @returns True when the amend may write.
   */
  const ensureAmendReady = useCallback(
    async (draft: string): Promise<boolean> => {
      if (sessionRef.current === null) {
        beginSession(draft);
      }

      return await loadAmendCommit();
    },
    [beginSession, loadAmendCommit],
  );

  /**
   * Applies a highlighted menu variant.
   *
   * An amend variant loads the previous message once and shows the indicator; a normal variant
   * restores the pre-menu draft so a normal commit never runs the amended message by accident.
   *
   * @param commandId - Highlighted variant command id.
   */
  const highlightVariant = useCallback(
    (commandId: string): void => {
      const variant = COMMIT_VARIANTS.find((candidate) => candidate.commandId === commandId);

      if (variant === undefined) {
        return;
      }

      if (!variant.amend) {
        const session = sessionRef.current;

        if (session !== null) {
          writeDraft(session.snapshot);
        }

        setAmendShortHash(null);

        return;
      }

      void loadAmendCommit();
    },
    [loadAmendCommit, writeDraft],
  );

  return {
    amendShortHash,
    clearAmendIndicator,
    beginSession,
    closeSession,
    highlightVariant,
    ensureAmendReady,
  };
}

/**
 * Applies the loaded values from the current session, when it still has them.
 *
 * @param session - Current session, or null when the menu closed or the run replaced it.
 * @param apply - Applies the message and indicator.
 */
function applyLoadedSession(
  session: ComposerMenuSession | null,
  apply: (loaded: { readonly message: string; readonly shortHash: string }) => void,
): void {
  if (session?.amendLoad !== null && session?.amendLoad !== undefined) {
    apply(session.amendLoad);
  }
}
