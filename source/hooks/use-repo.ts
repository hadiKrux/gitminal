import fs from 'node:fs';
import process from 'node:process';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GitError, GitNotFoundError, type GitResult } from '../git/exec.js';
import { resolveRepoInfo, type Identity } from '../git/repo-info.js';
import { readStatus } from '../git/status.js';
import {
	discardTracked as discardTrackedPaths,
	discardUntracked as discardUntrackedPaths,
	stage as stagePaths,
	unstage as unstagePaths,
	type WorkingTreePaths,
} from '../git/working-tree.js';
import { mapStatus } from '../data/map.js';
import { sanitizeOutput } from '../data/format.js';
import {
	categoryOf,
	type FileGroup,
	type WorkingFile,
	type WorkingGroupCategory,
	type WorkingTree,
} from '../data/types.js';

/** Which view the app should render; only `repo` carries working-tree data. */
export type RepoKind =
	| 'loading'
	| 'repo'
	| 'not-a-repo'
	| 'bare'
	| 'git-not-found'
	| 'error';

export type OperationStatus = 'running' | 'ok' | 'failed';

/**
 * Where an entry came from.
 *
 * Git runs, manual refreshes, and (from ticket 04) watcher degradation share
 * the log but not the shape of their work; the kind lets the console label
 * them without inferring intent from an empty argv.
 */
export type OperationLogKind = 'git' | 'refresh' | 'watch';

/**
 * One entry in the operation log.
 *
 * The log is the shared history behind the status line and the console, so
 * every run records what it did and what came back: the label in present tense
 * while it runs, the past-tense summary or the failure when it ends, and every
 * git argv that ran, in order.
 */
export type OperationLogEntry = {
	readonly id: number;
	readonly kind: OperationLogKind;
	/** Present tense, e.g. `staging 3 files`. */
	readonly label: string;
	/**
	 * Every git command that ran, in order; a chunked run has several, a plain
	 * one has a single argv. Empty until the command starts.
	 *
	 * The console renders the first argv joined plus an "(+N more)" marker when
	 * more than one command ran, so a chunked Stage All reads as one command
	 * with a count instead of 500 paths of argv.
	 */
	readonly args: ReadonlyArray<readonly string[]>;
	readonly startedAt: number;
	readonly endedAt?: number;
	readonly status: OperationStatus;
	/** Past tense on success (`staged 3 files`), else the failure summary. */
	readonly summary?: string;
	readonly error?: GitError;
	/** Reserved for streamed remote progress (ticket 09). */
	readonly progress?: number;
};

/** Whether the queue is running something, and its present-tense label. */
export type OperationState = {
	readonly busy: boolean;
	readonly label: string;
};

/**
 * A destructive action asking the app to confirm before it runs.
 *
 * `useRepo` cannot render anything, so it hands the request up; the app shows
 * the confirm overlay and calls `onConfirm` only when the user confirms.
 */
export type ConfirmRequest = {
	/** Overlay label, e.g. `Discard` or `Discard All`. */
	readonly label: string;
	readonly paths: readonly string[];
	readonly onConfirm: () => void;
};

export type UseRepoOptions = {
	readonly requestConfirm: (request: ConfirmRequest) => void;
};

export type RepoState = {
	readonly kind: RepoKind;
	/** Repository root; porcelain paths are relative to it. */
	readonly root: string | undefined;
	/**
	 * Absolute directory the live watcher watches: the common git dir, so a
	 * linked worktree sees shared refs as well as its own HEAD and index.
	 * Undefined outside a normal worktree: live sync only exists where there is
	 * state to re-read.
	 */
	readonly watchDir: string | undefined;
	/**
	 * True once the watcher degraded to manual refresh. Sticky for the session
	 * so the status line can keep warning after later log entries replace the
	 * degradation row; cleared when leaving the repository view or when a
	 * watcher is re-established.
	 */
	readonly watchDegraded: boolean;
	readonly branch: string;
	readonly workingFiles: readonly WorkingFile[];
	readonly fileGroups: readonly FileGroup[];
	readonly identity: Identity | undefined;
	/** Failure detail for the `error` kind; undefined otherwise. */
	readonly detail: string | undefined;
	/** The state the commit panel renders and acts through. */
	readonly workingTree: WorkingTree;
	readonly operation: OperationState;
	/** Append-only ring buffer; the newest entry is last. */
	readonly entries: readonly OperationLogEntry[];
	/**
	 * The failure that the status hint, enter, and failed console rows all
	 * point at: the newest failed entry, unless a later git run started or
	 * finished ok first. Refresh entries never hide an older failure, and a
	 * refresh failure is itself a valid target.
	 */
	readonly failedOperation: OperationLogEntry | undefined;
	stage: (paths: readonly string[]) => void;
	unstage: (paths: readonly string[]) => void;
	discard: (path: string) => void;
	stageAll: (category: WorkingGroupCategory) => void;
	unstageAll: (category: WorkingGroupCategory) => void;
	discardAll: (category: WorkingGroupCategory) => void;
	refresh: () => void;
};

type RepoSnapshot = Omit<
	RepoState,
	| 'workingTree'
	| 'operation'
	| 'entries'
	| 'failedOperation'
	| 'stage'
	| 'unstage'
	| 'discard'
	| 'stageAll'
	| 'unstageAll'
	| 'discardAll'
	| 'refresh'
>;

/** Entries kept in the ring buffer; older runs fall off the front. */
const operationLogCap = 200;

/**
 * Trailing debounce for git-directory events.
 *
 * One git command touches several files (index, HEAD, refs, logs), and a merge
 * or checkout touches many, so reacting to each event would re-read status in
 * bursts. Waiting until the writes settle turns the whole burst into one load.
 */
const watchDebounceMs = 250;

/**
 * The one line shown when live sync is unavailable.
 *
 * Binding-agnostic on purpose: refresh is rebindable, and naming `r` here
 * would be wrong for a user who mapped it elsewhere.
 */
export const watchUnavailableHint = 'live sync unavailable; refresh manually';

/**
 * Bounded retry for a watch event the last automatic load did not apply.
 *
 * A transient git failure must not stall live sync: the event is still
 * unapplied, so retry after 500ms, 1s, and 2s. After the third failure the
 * manual refresh key remains the fallback, and any successful applied load
 * resets the schedule.
 */
const watchRetryLimit = 3;
const watchRetryBaseMs = 500;
const watchRetryMaxMs = 2000;

/** 500ms, 1s, 2s, capped for any attempt beyond the schedule. */
const watchRetryDelayMs = (attempt: number): number =>
	Math.min(watchRetryBaseMs * 2 ** attempt, watchRetryMaxMs);

/**
 * Time given to the watcher to deliver the event for a write the queue just
 * finished, before the post-drain load snapshots the watch sequence.
 *
 * macOS can deliver an FSEvents notification while `load` is already in
 * flight; without this pause the event looks newer than the load and triggers
 * a second refresh for a write the load is already reading. Long enough for a
 * local notification to arrive, short enough to stay imperceptible.
 *
 * This is a heuristic, not a guarantee. If the OS delivers a mutation event
 * after this window, the load snapshots the older sequence and the
 * conservative applied-sequence check in `drain` starts one follow-up load.
 * That costs an extra refresh row and `git status` chain on slow delivery, but
 * never leaves state stale or loops.
 *
 * A pending watch request whose event the drain load already applied (for
 * example one queued while an earlier load was in flight) is dropped when
 * consumed, so a stale request does not add a second load either.
 */
const watchSettleMs = 50;

/** Pause once before the drain load when a live watcher can deliver events. */
const settleWatchEvents = async (): Promise<void> =>
	new Promise(resolve => {
		setTimeout(resolve, watchSettleMs);
	});

/** Edge states have no working tree; the app renders their message instead. */
const edge = (kind: RepoKind, detail?: string): RepoSnapshot => ({
	kind,
	root: undefined,
	watchDir: undefined,
	watchDegraded: false,
	branch: '',
	workingFiles: [],
	fileGroups: [],
	identity: undefined,
	detail,
});

type MutationVerb = 'stage' | 'unstage' | 'discard';

/**
 * Present and past tense per verb.
 *
 * Written out rather than derived from the verb: suffixing `ing`/`ed` produces
 * `stageing`/`stageed`, and English irregular forms do not survive a rule.
 */
const mutationWords: Readonly<
	Record<MutationVerb, { readonly busy: string; readonly done: string }>
> = {
	stage: { busy: 'staging', done: 'staged' },
	unstage: { busy: 'unstaging', done: 'unstaged' },
	discard: { busy: 'discarding', done: 'discarded' },
};

/** `staging 3 files` / `staged 3 files`, singular at exactly one path. */
const mutationLabels = (
	verb: MutationVerb,
	paths: readonly string[],
): { readonly busy: string; readonly done: string } => {
	const count = `${paths.length} file${paths.length === 1 ? '' : 's'}`;
	const words = mutationWords[verb];
	return { busy: `${words.busy} ${count}`, done: `${words.done} ${count}` };
};

/**
 * The single line the status line shows for a failure.
 *
 * Classification into readable summaries arrives with ticket 09; until then
 * git's own stderr is the most honest summary, sanitized because the status
 * line renders it literally, and the full output stays in the error overlay.
 * CR-framed progress can put many updates on one logical line, so the search
 * splits on both CR and LF and prefers a line that names the failure over
 * whichever progress line happened to come first.
 */
const failureSummary = (error: GitError): string => {
	const lines = error.stderr
		.split(/[\r\n]+/)
		.map(text => sanitizeOutput(text).trim())
		.filter(text => text.length > 0);
	const failure = lines.find(text => /fatal|error|failed/i.test(text));

	return failure ?? lines[0] ?? sanitizeOutput(error.message);
};

/**
 * The log and the error overlay both carry a `GitError`, so a non-git throw is
 * wrapped rather than swallowed: a programming error still surfaces with its
 * message instead of vanishing into an `ok` entry.
 */
const toGitError = (error: unknown): GitError => {
	if (error instanceof GitError) {
		return error;
	}

	const message = error instanceof Error ? error.message : String(error);
	return new GitError(
		{
			args: [],
			exitCode: undefined,
			stdout: '',
			// The overlay reads captured output; without this a wrapped
			// non-git failure would show `(no output captured)` instead of
			// its real reason.
			stderr: message,
		},
		message,
	);
};

/**
 * Why a load is running.
 *
 * The mount load owns the app's edge states: with nothing else to show, a
 * failure becomes the full error view. `manual` is an explicit `r`: it may
 * adopt a genuine not-a-repo or bare transition because the user asked for
 * the truth. The automatic modes (`watch` for watcher events and retries,
 * `drain` for the post-queue load) preserve the last good repository view when
 * an edge probe looks transient, and report through the log instead; a
 * mid-checkout `git status` must not wipe the UI and tear the watcher down.
 */
type LoadMode = 'initial' | 'manual' | 'watch' | 'drain';

/**
 * Which load the single refresh slot should run next.
 *
 * `manual` wins over `watch` when both requests are pending: the explicit key
 * must be able to adopt an edge state even if a watcher event asked first.
 */
type RefreshMode = 'manual' | 'watch';

/** Only automatic loads keep the last good view on an edge probe. */
const isAutomaticLoad = (mode: LoadMode): boolean =>
	mode === 'watch' || mode === 'drain';

/**
 * A failure the probe reported without a command to blame.
 *
 * The status line uses the concise summary, while the error overlay reads the
 * same reason from `stderr`; without a payload it would render `(no output
 * captured)` and offer details that are not there.
 */
const probeFailure = (
	summary: string,
): {
	readonly status: 'failed';
	readonly summary: string;
	readonly error: GitError;
} => ({
	status: 'failed',
	summary,
	error: new GitError(
		{ args: [], exitCode: undefined, stdout: '', stderr: summary },
		summary,
	),
});

/**
 * What one `load` attempt observed.
 *
 * `load` keeps owning its error handling (it sets the edge states the app
 * renders); returning the outcome lets a manual refresh record the same result
 * in the log without duplicating any of that logic. A superseded request is
 * distinct from success because it never applied its state: a refresh that
 * logs it must say so instead of claiming it refreshed.
 */
type LoadOutcome =
	| { readonly status: 'ok' }
	| { readonly status: 'superseded' }
	| {
			readonly status: 'failed';
			readonly summary: string;
			readonly error?: GitError;
	  };

type QueuedRun = {
	readonly id: number;
	/** Present-tense label for the busy state and the log entry. */
	readonly label: string;
	/** Past-tense summary recorded when the run succeeds. */
	readonly summary: string;
	/**
	 * `reportCommand` receives each command's argv as soon as it completes, so
	 * a run that fails partway still knows which earlier commands succeeded.
	 */
	readonly run: (
		reportCommand: (args: readonly string[]) => void,
	) => Promise<readonly GitResult[]>;
};

/**
 * Owns the real repository state for the app.
 *
 * One state owner: it resolves the repository root once (every command runs
 * with `cwd: root`, because porcelain paths are root-relative and the CLI may
 * have been launched from a nested subdirectory), loads status, and serializes
 * every mutation through a single queue so concurrent clicks cannot race the
 * index. The queue loads once when it drains, plus at most one conservative
 * follow-up load if a mutation event reaches the watcher late, and records
 * every run in an append-only log that the status line and the console read.
 */
export const useRepo = ({ requestConfirm }: UseRepoOptions): RepoState => {
	const [state, setState] = useState<RepoSnapshot>(() => edge('loading'));
	const [entries, setEntries] = useState<readonly OperationLogEntry[]>([]);

	const mountedRef = useRef(true);
	const requestId = useRef(0);
	const filesRef = useRef<readonly WorkingFile[]>([]);
	const stateRef = useRef(state);
	const queueRef = useRef<QueuedRun[]>([]);
	const isDrainingRef = useRef(false);
	const isRefreshingRef = useRef(false);
	/** Pending mode for the refresh slot; undefined means nothing queued. */
	const refreshPendingRef = useRef<RefreshMode | undefined>(undefined);
	const nextIdRef = useRef(0);
	/**
	 * Ordering guard for the feedback loop.
	 *
	 * `watchEventSeq` increments on every raw `fs.watch` event; `appliedWatchSeq`
	 * records the sequence a load actually applied to state. Only a successful
	 * apply consumes an event: a failed or superseded load leaves the marker
	 * older, so the event stays pending and the bounded retry can pick it up. A
	 * counter rather than `Date.now()` because an event and the drain load that
	 * absorbs it can easily land in the same millisecond, and wall-clock
	 * equality cannot tell which happened first.
	 */
	const watchEventSeqRef = useRef(0);
	const appliedWatchSeqRef = useRef(0);
	const watchTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);
	const watchRetryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);
	const watchRetryAttemptsRef = useRef(0);
	/**
	 * The in-flight refresh slot, if any.
	 *
	 * `drain` waits on this before running its first queued mutation so a load
	 * that started before the drain cannot read beside a write. `runRefresh`
	 * breaks before starting a new iteration while `isDrainingRef` is set, so
	 * the promise resolves after the load already in flight and the wait cannot
	 * deadlock.
	 */
	const refreshDoneRef = useRef<Promise<void> | undefined>(undefined);
	/**
	 * Latest `refreshFromWatch`, for the retry timer.
	 *
	 * `runRefresh` is defined before `refreshFromWatch` because the watch path
	 * calls the refresh slot; a ref keeps the retry timer from inverting that
	 * dependency.
	 */
	const refreshFromWatchRef = useRef<(() => void) | undefined>(undefined);
	/**
	 * Whether a watcher is actually delivering events.
	 *
	 * Only a live watcher can make the post-drain settle worthwhile; a bare
	 * state, an edge state, or a degraded watch has nothing to wait for, so the
	 * queue must not pay that delay.
	 */
	const isWatchingRef = useRef(false);
	/**
	 * The entry that explains a degraded watcher, kept outside the log ring.
	 *
	 * The status hint is sticky for the session, but the log is capped at 200
	 * entries. Holding the entry here means enter can still open the reason
	 * after ring eviction. It is cleared when a watcher is live again, because
	 * a stale failure must not back a current warning.
	 */
	const watchFailureRef = useRef<OperationLogEntry | undefined>(undefined);

	// Actions read this instead of closing over `state`, so a click right after
	// a refresh operates on the same snapshot the panel is showing; writing it
	// during render (not in an effect) closes the one-commit window where the
	// view had new files and the ref still had the old ones.
	filesRef.current = state.workingFiles;
	// `load` reads the current kind without depending on the state object: an
	// automatic not-a-repo or bare probe preserves a rendered repository view.
	stateRef.current = state;

	/** Drop a pending watch retry and reset its backoff for the next failure. */
	const cancelWatchRetry = useCallback((): void => {
		if (watchRetryTimerRef.current !== undefined) {
			clearTimeout(watchRetryTimerRef.current);
			watchRetryTimerRef.current = undefined;
		}

		watchRetryAttemptsRef.current = 0;
	}, []);

	/**
	 * Retry a watch event the failed load left unapplied.
	 *
	 * Called after a failed automatic load. The timer asks the normal watch
	 * path for a refresh, so the queue and drain gates still decide whether it
	 * is safe to run; only a newer event and a free queue can start a load.
	 */
	const scheduleWatchRetry = useCallback((): void => {
		if (!mountedRef.current || !isWatchingRef.current) {
			return;
		}

		if (appliedWatchSeqRef.current >= watchEventSeqRef.current) {
			return;
		}

		// A retry is already queued and will observe the newest event.
		if (watchRetryTimerRef.current !== undefined) {
			return;
		}

		if (watchRetryAttemptsRef.current >= watchRetryLimit) {
			return;
		}

		const delay = watchRetryDelayMs(watchRetryAttemptsRef.current);
		watchRetryAttemptsRef.current += 1;
		watchRetryTimerRef.current = setTimeout(() => {
			watchRetryTimerRef.current = undefined;
			if (!mountedRef.current) {
				return;
			}

			refreshFromWatchRef.current?.();
		}, delay);
	}, []);

	const load = useCallback(
		async (mode: LoadMode): Promise<LoadOutcome> => {
			const loadWatchSeq = watchEventSeqRef.current;
			requestId.current += 1;
			const request = requestId.current;
			const isCurrent = (): boolean =>
				mountedRef.current && requestId.current === request;
			/**
			 * Mark the watch sequence this load observed as consumed.
			 *
			 * Only a load that actually set state calls this, so a failed or
			 * superseded attempt leaves its event pending for the retry path.
			 */
			const markApplied = (): void => {
				appliedWatchSeqRef.current = loadWatchSeq;
				cancelWatchRetry();
			};

			try {
				const probe = await resolveRepoInfo({ cwd: process.cwd() });

				if (!isCurrent()) {
					return { status: 'superseded' };
				}

				if (probe.repo.kind === 'not-a-repo') {
					/*
					 * An automatic probe that no longer sees the repository
					 * keeps the last good view: a moved, repaired, or briefly
					 * unavailable `.git` must not tear the view and the watcher
					 * down. Initial and manual loads own the real edge state,
					 * because the user explicitly asked for it.
					 */
					if (isAutomaticLoad(mode) && stateRef.current.kind === 'repo') {
						return probeFailure('repository is no longer available');
					}

					setState(edge('not-a-repo'));
					markApplied();
					return { status: 'ok' };
				}

				if (probe.repo.kind === 'bare') {
					if (isAutomaticLoad(mode) && stateRef.current.kind === 'repo') {
						return probeFailure('repository is now bare');
					}

					setState(edge('bare'));
					markApplied();
					return { status: 'ok' };
				}

				const { root, commonDir } = probe.repo;
				const status = await readStatus({ cwd: root });

				if (!isCurrent()) {
					return { status: 'superseded' };
				}

				const view = mapStatus(status);
				setState(current => ({
					kind: 'repo',
					root,
					watchDir: commonDir,
					// Degradation is owned by the watcher effect, not by a reload:
					// carrying it through here keeps the hint until a watch is live.
					watchDegraded: current.watchDegraded,
					branch: view.branch,
					workingFiles: view.workingFiles,
					fileGroups: view.fileGroups,
					identity: probe.identity,
					detail: undefined,
				}));
				markApplied();
				return { status: 'ok' };
			} catch (error: unknown) {
				if (!isCurrent()) {
					return { status: 'superseded' };
				}

				if (error instanceof GitNotFoundError) {
					setState(current =>
						mode === 'initial' || current.kind !== 'repo'
							? edge('git-not-found')
							: current,
					);
					return {
						status: 'failed',
						summary: 'git not found',
						error: toGitError(error),
					};
				}

				const message = error instanceof Error ? error.message : String(error);
				const gitError = toGitError(error);
				setState(current =>
					mode === 'initial' || current.kind !== 'repo'
						? edge('error', message)
						: current,
				);
				return {
					status: 'failed',
					// The log and status line show this, so prefer git's own line
					// ("index file corrupt") over the argv-only error message.
					summary: failureSummary(gitError),
					error: gitError,
				};
			}
		},
		[cancelWatchRetry],
	);

	useEffect(() => {
		mountedRef.current = true;
		void load('initial');

		return () => {
			// A late resolve must not set state after unmount.
			mountedRef.current = false;
			cancelWatchRetry();
		};
	}, [cancelWatchRetry, load]);

	/** Run one queued operation and record its outcome in the log. */
	const runQueued = useCallback(async (queued: QueuedRun): Promise<void> => {
		const entry: OperationLogEntry = {
			id: queued.id,
			kind: 'git',
			label: queued.label,
			args: [],
			startedAt: Date.now(),
			status: 'running',
		};

		// A queued run gets no entry until it starts, so the status line only
		// ever shows the running one; the console records the same start.
		setEntries(current => [...current, entry].slice(-operationLogCap));

		const completedArgs: string[][] = [];
		let finished: OperationLogEntry;

		try {
			const results = await queued.run(args => {
				completedArgs.push([...args]);
			});
			finished = {
				...entry,
				// Every git command the run spawned, in order (chunked runs have
				// one per chunk); each argv carries the global flags already.
				args: results.map(result => result.args),
				endedAt: Date.now(),
				status: 'ok',
				summary: queued.summary,
			};
		} catch (error: unknown) {
			const gitError = toGitError(error);
			finished = {
				...entry,
				// Keep the chunks that completed before the failing command, so
				// a failed chunked run shows the same "(+N more)" history as a
				// successful one; the failing argv comes from the error itself.
				args: [...completedArgs, gitError.args],
				endedAt: Date.now(),
				status: 'failed',
				summary: failureSummary(gitError),
				error: gitError,
			};
		}

		if (!mountedRef.current) {
			return;
		}

		setEntries(current =>
			current.map(item => (item.id === entry.id ? finished : item)),
		);
	}, []);

	/**
	 * Run at most one refresh at a time, with a single pending slot.
	 *
	 * Repeated `r` presses must not each spawn a `git status` chain; a press
	 * while one is running only asks for one more after it finishes, and any
	 * number of presses in that window collapse into that one request. The
	 * watcher feeds the same slot, so a live refresh and a manual one can never
	 * run two load chains side by side. Each actual run logs its own entry and
	 * its real outcome, including a load that a newer request superseded.
	 */
	const runRefresh = useCallback(async (): Promise<void> => {
		if (isRefreshingRef.current) {
			return;
		}

		isRefreshingRef.current = true;
		let resolveRefreshDone: (() => void) | undefined;
		refreshDoneRef.current = new Promise<void>(resolve => {
			resolveRefreshDone = resolve;
		});

		try {
			while (refreshPendingRef.current !== undefined && mountedRef.current) {
				/*
				 * A manual `r` pressed during a drain must not start a load
				 * beside the queued git command. Leave the request pending and
				 * let the drain start this loop again once its own load is
				 * done; that is also why the drain re-checks the pending mode.
				 */
				if (isDrainingRef.current || queueRef.current.length > 0) {
					break;
				}

				// Consume the mode once, before awaiting: a later manual press
				// during this load must survive as the next request.
				const refreshMode = refreshPendingRef.current;
				refreshPendingRef.current = undefined;

				/*
				 * A watch request is stale when the load that just applied
				 * already observed its event (for example the drain load after
				 * a mutation). Drop it instead of running a redundant load; a
				 * manual request must still run.
				 */
				if (
					refreshMode === 'watch' &&
					appliedWatchSeqRef.current >= watchEventSeqRef.current
				) {
					continue;
				}

				nextIdRef.current += 1;
				const entry: OperationLogEntry = {
					id: nextIdRef.current,
					kind: 'refresh',
					label: 'refreshing',
					args: [],
					startedAt: Date.now(),
					status: 'running',
				};

				setEntries(current => [...current, entry].slice(-operationLogCap));

				// Serial by design: this slot is what turns a burst of presses
				// into one git status chain.
				// eslint-disable-next-line no-await-in-loop
				const outcome = await load(
					refreshMode === 'manual' ? 'manual' : 'watch',
				);

				if (!mountedRef.current) {
					return;
				}

				let finished: OperationLogEntry;
				if (outcome.status === 'failed') {
					finished = {
						...entry,
						endedAt: Date.now(),
						status: 'failed',
						summary: outcome.summary,
						error: outcome.error,
					};
					// The watch event that triggered this load is still
					// unapplied; retry it instead of leaving the view stale.
					scheduleWatchRetry();
				} else {
					finished = {
						...entry,
						endedAt: Date.now(),
						status: 'ok',
						summary:
							outcome.status === 'superseded'
								? 'superseded by a newer load'
								: 'refreshed',
					};
				}

				setEntries(current =>
					current.map(item => (item.id === entry.id ? finished : item)),
				);
			}
		} finally {
			isRefreshingRef.current = false;
			refreshDoneRef.current = undefined;
			resolveRefreshDone?.();
		}
	}, [load, scheduleWatchRetry]);

	/**
	 * Queue one load in the single refresh slot.
	 *
	 * Manual wins over watch when both arrive before the next actual load: an
	 * explicit `r` must adopt a real edge transition even if a watcher event
	 * asked first. The mode resets when `runRefresh` consumes it. While the
	 * queue is busy only the request is marked; the drain starts the slot
	 * after its own load, so the manual key and the watcher obey the same rule.
	 */
	const requestRefresh = useCallback(
		(mode: RefreshMode) => {
			if (mode === 'manual' || refreshPendingRef.current === undefined) {
				refreshPendingRef.current = mode;
			}

			/*
			 * A load must not run beside the queue: the queued git command can
			 * be mid-write on the index. Only mark the request here.
			 */
			if (isDrainingRef.current || queueRef.current.length > 0) {
				return;
			}

			void runRefresh();
		},
		[runRefresh],
	);

	const refresh = useCallback(() => {
		requestRefresh('manual');
	}, [requestRefresh]);

	/**
	 * Start a watcher refresh only when it would add information.
	 *
	 * The watcher must not run beside the operation queue: a load racing a git
	 * mutation can render a half-written index. When the queue is busy it is
	 * also redundant, because the queue's post-drain `load` sees the final
	 * state; `drain` calls this again once it is idle and only asks for a
	 * refresh if an event arrived after its last applied load (see the
	 * invariant in `drain`).
	 *
	 * `appliedWatchSeqRef` is checked for the same reason in the idle case: a
	 * manual `r` (or a drain load) that applied after the newest event already
	 * observed it, so a second load would only repeat work. A failed or
	 * superseded load never advances that marker.
	 */
	const refreshFromWatch = useCallback(() => {
		if (!mountedRef.current) {
			return;
		}

		if (isDrainingRef.current || queueRef.current.length > 0) {
			return;
		}

		if (appliedWatchSeqRef.current >= watchEventSeqRef.current) {
			return;
		}

		requestRefresh('watch');
	}, [requestRefresh]);
	refreshFromWatchRef.current = refreshFromWatch;

	/** Restart the trailing debounce; the latest event is what gets acted on. */
	const scheduleWatchRefresh = useCallback(() => {
		if (watchTimerRef.current !== undefined) {
			clearTimeout(watchTimerRef.current);
		}

		watchTimerRef.current = setTimeout(() => {
			watchTimerRef.current = undefined;
			refreshFromWatch();
		}, watchDebounceMs);
	}, [refreshFromWatch]);

	/**
	 * Live sync on the resolved common git directory.
	 *
	 * The common dir is watched rather than the per-worktree git dir: in a
	 * linked worktree the latter holds only that worktree's HEAD and index,
	 * while the shared refs (branches, stash, fetched refs) live in the common
	 * dir. A recursive watch there covers both, so branch, stash, and fetch
	 * changes are visible from any worktree. In a normal checkout the two paths
	 * are the same.
	 *
	 * Only the git dir is watched: every git command touches it, while a plain
	 * file edit in the worktree does not, which is why the manual refresh key
	 * stays as the fallback for that documented gap.
	 *
	 * A failure is degradation, not a crash: `watchDegraded` keeps the status
	 * line's hint visible for the rest of the session (log entries move on),
	 * one `watch` entry records the reason in the console, and the app keeps
	 * working through manual refresh. The per-effect `hasFailed` flag keeps a
	 * synchronous start failure and a later error event from logging twice.
	 */
	const { watchDir } = state;
	useEffect(() => {
		if (watchDir === undefined) {
			return;
		}

		let isDisposed = false;
		let hasFailed = false;

		const degrade = (reason: string): void => {
			if (isDisposed || hasFailed) {
				return;
			}

			hasFailed = true;
			isWatchingRef.current = false;
			// No watcher means no event can justify a retry.
			cancelWatchRetry();
			setState(current =>
				current.watchDegraded ? current : { ...current, watchDegraded: true },
			);
			nextIdRef.current += 1;
			const entry: OperationLogEntry = {
				id: nextIdRef.current,
				kind: 'watch',
				label: 'watch git directory',
				args: [],
				startedAt: Date.now(),
				status: 'failed',
				summary: watchUnavailableHint,
				error: new GitError(
					{ args: [], exitCode: undefined, stdout: '', stderr: reason },
					reason,
				),
			};

			// Keep the explanation after the log ring evicts the entry.
			watchFailureRef.current = entry;
			setEntries(current => [...current, entry].slice(-operationLogCap));
		};

		let watcher: fs.FSWatcher;
		try {
			watcher = fs.watch(watchDir, { recursive: true }, () => {
				if (isDisposed) {
					return;
				}

				watchEventSeqRef.current += 1;
				scheduleWatchRefresh();
			});
		} catch (error: unknown) {
			degrade(error instanceof Error ? error.message : String(error));
			return;
		}

		/**
		 * Node 20.14 on Linux can throw from `close()` when a recursive watch
		 * setup missed a file that was removed mid-scan (the setup bug fixed in
		 * 20.15): `Cannot read properties of undefined (reading 'close')`.
		 * A failed close is still a degraded watcher, so contain it and leave
		 * manual refresh as the fallback instead of crashing the TUI.
		 */
		const closeWatcher = (): void => {
			try {
				watcher.close();
			} catch {
				// The watcher is already unusable; degradation owns the fallback.
			}
		};

		// This watcher is live: clear a sticky degradation from an earlier
		// watch root so the hint only survives while sync is actually down.
		isWatchingRef.current = true;
		watchFailureRef.current = undefined;
		setState(current =>
			current.watchDegraded ? { ...current, watchDegraded: false } : current,
		);

		watcher.on('error', error => {
			if (isDisposed) {
				return;
			}

			degrade(error.message);
			closeWatcher();
		});

		return () => {
			isDisposed = true;
			isWatchingRef.current = false;
			if (watchTimerRef.current !== undefined) {
				clearTimeout(watchTimerRef.current);
				watchTimerRef.current = undefined;
			}

			cancelWatchRetry();
			closeWatcher();
		};
	}, [cancelWatchRetry, scheduleWatchRefresh, watchDir]);

	/**
	 * Drain the queue serially, then load once.
	 *
	 * Each action already reads git's own result, so a refresh per run would
	 * only multiply git calls; the panel needs the final state, nothing in
	 * between. Runs queued while that load is in flight start another drain.
	 * If a mutation event arrives after the load snapshots the sequence, the
	 * applied-sequence check starts at most one conservative follow-up load.
	 */
	const drain = useCallback(async (): Promise<void> => {
		if (isDrainingRef.current) {
			return;
		}

		isDrainingRef.current = true;
		let needsWatchRefresh = false;

		try {
			/*
			 * A manual or watch load may still be reading when the first
			 * mutation is queued. Wait it out: a git read must not run beside a
			 * write. `runRefresh` breaks before starting another iteration
			 * while the drain flag is set, so this resolves once the in-flight
			 * load is done and cannot deadlock.
			 */
			const inFlightRefresh = refreshDoneRef.current;
			if (inFlightRefresh !== undefined) {
				await inFlightRefresh;
			}

			while (mountedRef.current) {
				let ranAnOperation = false;

				while (mountedRef.current && queueRef.current.length > 0) {
					const queued = queueRef.current.shift();
					if (queued === undefined) {
						break;
					}

					ranAnOperation = true;
					// Serial by design: the queue exists so concurrent clicks
					// cannot race the index.
					// eslint-disable-next-line no-await-in-loop
					await runQueued(queued);
				}

				if (!ranAnOperation) {
					break;
				}

				/*
				 * Let the watcher deliver the writes this drain just made before
				 * the load snapshots the sequence; otherwise its own index
				 * event arrives during the load and causes a second refresh.
				 * Only a live watcher can deliver that event: in an edge state
				 * or after degradation the wait cannot buy anything, so the
				 * queue does not pay it.
				 */
				if (isWatchingRef.current) {
					// eslint-disable-next-line no-await-in-loop
					await settleWatchEvents();
				}

				if (!mountedRef.current) {
					break;
				}

				const loadStartedAt = Date.now();
				// eslint-disable-next-line no-await-in-loop -- one load after the last run, plus at most one conservative follow-up
				const outcome = await load('drain');

				if (outcome.status === 'failed' && mountedRef.current) {
					/*
					 * The drain's own load is not otherwise logged. A failure
					 * that kept the last good view must still be visible in the
					 * console and the status line, so record it like a manual
					 * refresh would.
					 */
					nextIdRef.current += 1;
					const entry: OperationLogEntry = {
						id: nextIdRef.current,
						kind: 'refresh',
						label: 'refreshing',
						args: [],
						startedAt: loadStartedAt,
						endedAt: Date.now(),
						status: 'failed',
						summary: outcome.summary,
						error: outcome.error,
					};

					setEntries(current => [...current, entry].slice(-operationLogCap));
					// The failed load never consumed the watch event that
					// triggered it; retry within the bounded schedule.
					scheduleWatchRetry();
				}

				if (queueRef.current.length === 0) {
					break;
				}
			}

			/*
			 * The feedback-loop invariant: our own operations write to `.git`,
			 * so the watcher sees them too. The drain load consumes only the
			 * sequence it actually applied, so every event up to the last
			 * applied load is already in the state it read. An event that
			 * arrived after that, or one a failed or superseded load never
			 * applied, still needs a watch refresh. This is also why a watch
			 * event seen before the drain load waits here instead of scheduling
			 * its own.
			 *
			 * The settle above is only a heuristic: a late OS event lands
			 * here and starts one conservative follow-up load. That extra
			 * refresh row is accepted; it never leaves stale state or loops.
			 */
			needsWatchRefresh = watchEventSeqRef.current > appliedWatchSeqRef.current;
		} finally {
			isDrainingRef.current = false;
		}

		if (needsWatchRefresh) {
			refreshFromWatch();
		}

		/*
		 * A manual `r` pressed while the queue was busy only marked a pending
		 * mode. Now that the drain and its own load are done, start the normal
		 * refresh slot for it. If the watch refresh above already started that
		 * slot, its single-flight guard makes this a no-op.
		 */
		if (refreshPendingRef.current !== undefined && !isRefreshingRef.current) {
			void runRefresh();
		}
	}, [load, refreshFromWatch, runQueued, runRefresh, scheduleWatchRetry]);

	const enqueue = useCallback(
		(label: string, summary: string, run: QueuedRun['run']): void => {
			nextIdRef.current += 1;
			queueRef.current.push({ id: nextIdRef.current, label, summary, run });
			void drain();
		},
		[drain],
	);

	/** Enqueue a mutation over a path list under the given verb. */
	const runMutation = useCallback(
		(
			verb: MutationVerb,
			paths: readonly string[],
			run: (mutation: WorkingTreePaths) => Promise<readonly GitResult[]>,
		): void => {
			if (state.root === undefined || paths.length === 0) {
				return;
			}

			const { busy, done } = mutationLabels(verb, paths);
			const cwd = state.root;
			enqueue(busy, done, async reportCommand =>
				run({ cwd, paths, onCommand: reportCommand }),
			);
		},
		[enqueue, state.root],
	);

	const stage = useCallback(
		(paths: readonly string[]) => {
			runMutation('stage', paths, stagePaths);
		},
		[runMutation],
	);

	const unstage = useCallback(
		(paths: readonly string[]) => {
			runMutation('unstage', paths, unstagePaths);
		},
		[runMutation],
	);

	/**
	 * Discard one path.
	 *
	 * A tracked path is restored from the index, which is recoverable, so it
	 * runs directly. An untracked path has no index copy and is gone for good
	 * once removed, so a single row asks first too.
	 */
	const discard = useCallback(
		(path: string) => {
			const file = filesRef.current.find(item => item.path === path);
			if (file === undefined) {
				return;
			}

			if (categoryOf(file) === 'untracked') {
				requestConfirm({
					label: 'Discard',
					paths: [path],
					onConfirm() {
						runMutation('discard', [path], discardUntrackedPaths);
					},
				});
				return;
			}

			// A tracked path with no worktree change (staged-new, staged-only,
			// staged-deleted) has nothing to restore: `git restore --worktree`
			// exits 0 without touching anything, so enqueuing would log a
			// discard that never happened. The row hides its Discard button for
			// the same reason; this guard also stops programmatic callers.
			if (!file.hasUnstaged) {
				return;
			}

			runMutation('discard', [path], discardTrackedPaths);
		},
		[requestConfirm, runMutation],
	);

	/** Paths in a group that the bulk action would actually change. */
	const bulkPaths = useCallback(
		(
			category: WorkingGroupCategory,
			predicate: (file: WorkingFile) => boolean,
		): readonly string[] =>
			filesRef.current
				.filter(file => categoryOf(file) === category && predicate(file))
				.map(file => file.path),
		[],
	);

	const stageAll = useCallback(
		(category: WorkingGroupCategory) => {
			// Everything not already staged; an unstaged change on an otherwise
			// staged file still needs its worktree state recorded.
			runMutation(
				'stage',
				bulkPaths(category, file => !file.staged || file.hasUnstaged),
				stagePaths,
			);
		},
		[bulkPaths, runMutation],
	);

	const unstageAll = useCallback(
		(category: WorkingGroupCategory) => {
			runMutation(
				'unstage',
				bulkPaths(category, file => file.staged),
				unstagePaths,
			);
		},
		[bulkPaths, runMutation],
	);

	const discardAll = useCallback(
		(category: WorkingGroupCategory) => {
			const paths = bulkPaths(category, file => file.hasUnstaged);
			if (paths.length === 0) {
				return;
			}

			// Bulk discards always ask first, for both categories: one click
			// must not be able to throw away a whole group.
			requestConfirm({
				label: 'Discard All',
				paths,
				onConfirm() {
					runMutation(
						'discard',
						paths,
						category === 'untracked'
							? discardUntrackedPaths
							: discardTrackedPaths,
					);
				},
			});
		},
		[bulkPaths, requestConfirm, runMutation],
	);

	const workingTree = useMemo<WorkingTree>(
		() => ({
			files: state.workingFiles,
			stagedCount: state.workingFiles.filter(file => file.staged).length,
			isStaged(path: string) {
				return state.workingFiles.some(
					file => file.path === path && file.staged,
				);
			},
			hasUnstaged(category: WorkingGroupCategory) {
				return state.workingFiles.some(
					file =>
						categoryOf(file) === category && (!file.staged || file.hasUnstaged),
				);
			},
			toggleStage(path: string) {
				const file = state.workingFiles.find(item => item.path === path);
				if (file === undefined) {
					return;
				}

				if (file.staged) {
					unstage([path]);
				} else {
					stage([path]);
				}
			},
			stageAll,
			unstageAll,
			discard,
			discardAll,
		}),
		[
			state.workingFiles,
			stage,
			unstage,
			discard,
			stageAll,
			unstageAll,
			discardAll,
		],
	);

	/**
	 * Status line state, derived from the log rather than tracked beside it.
	 *
	 * The newest running entry is the busy head; when none is running the line
	 * falls back to the newest finished entry. One source means the console and
	 * the status line cannot disagree about what is happening.
	 */
	const operation = useMemo<OperationState>(() => {
		for (let index = entries.length - 1; index >= 0; index -= 1) {
			const entry = entries[index];
			if (entry?.status === 'running') {
				return { busy: true, label: entry.label };
			}
		}

		return { busy: false, label: '' };
	}, [entries]);

	/**
	 * The one failure the status hint, enter, and failed row clicks point at.
	 *
	 * Scanned newest-first from the same log the console renders: the newest
	 * failed entry wins regardless of kind, but a later git run that started or
	 * finished ok means the previous failure is history. A refresh entry is not
	 * a git run, so it never hides an older failure and a refresh failure can
	 * itself be the target.
	 *
	 * While live sync is degraded the watch failure must stay reachable even
	 * after a successful git entry, because the status line keeps showing the
	 * warning and its details hint must agree. A newer failure of any kind
	 * still supersedes it. The log ring can evict the watch entry eventually,
	 * so the sticky reference supplies the target when the scan finds none.
	 */
	const failedOperation = useMemo<OperationLogEntry | undefined>(() => {
		for (let index = entries.length - 1; index >= 0; index -= 1) {
			const entry = entries[index];
			if (entry === undefined) {
				continue;
			}

			if (entry.status === 'failed') {
				/*
				 * A watch failure describes live sync, not a git run. While
				 * degraded it is a valid target; once a watcher is live again
				 * it is history and must not leave a details hint pointing at
				 * a stale failure.
				 */
				if (entry.kind === 'watch' && !state.watchDegraded) {
					return undefined;
				}

				return entry;
			}

			/*
			 * A successful git run normally ends the scan: the failure it
			 * followed is history. While degraded it must not hide the watch
			 * failure, or the warning would lose the only explanation path.
			 */
			if (entry.kind === 'git' && !state.watchDegraded) {
				return undefined;
			}
		}

		return state.watchDegraded ? watchFailureRef.current : undefined;
	}, [entries, state.watchDegraded]);

	return {
		...state,
		workingTree,
		operation,
		entries,
		failedOperation,
		stage,
		unstage,
		discard,
		stageAll,
		unstageAll,
		discardAll,
		refresh,
	};
};
