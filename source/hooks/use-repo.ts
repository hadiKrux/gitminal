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

/** Edge states have no working tree; the app renders their message instead. */
const edge = (kind: RepoKind, detail?: string): RepoSnapshot => ({
	kind,
	root: undefined,
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

	return new GitError(
		{ args: [], exitCode: undefined, stdout: '', stderr: '' },
		error instanceof Error ? error.message : String(error),
	);
};

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
 * index. The queue refreshes exactly once when it drains, and records every run
 * in an append-only log that the status line and the console read.
 */
export const useRepo = ({ requestConfirm }: UseRepoOptions): RepoState => {
	const [state, setState] = useState<RepoSnapshot>(() => edge('loading'));
	const [entries, setEntries] = useState<readonly OperationLogEntry[]>([]);

	const mountedRef = useRef(true);
	const requestId = useRef(0);
	const filesRef = useRef<readonly WorkingFile[]>([]);
	const queueRef = useRef<QueuedRun[]>([]);
	const isDrainingRef = useRef(false);
	const isRefreshingRef = useRef(false);
	const refreshPendingRef = useRef(false);
	const nextIdRef = useRef(0);

	// Actions read this instead of closing over `state`, so a click right after
	// a refresh operates on the same snapshot the panel is showing; writing it
	// during render (not in an effect) closes the one-commit window where the
	// view had new files and the ref still had the old ones.
	filesRef.current = state.workingFiles;

	const load = useCallback(async (): Promise<LoadOutcome> => {
		requestId.current += 1;
		const request = requestId.current;
		const isCurrent = (): boolean =>
			mountedRef.current && requestId.current === request;

		try {
			const probe = await resolveRepoInfo({ cwd: process.cwd() });

			if (!isCurrent()) {
				return { status: 'superseded' };
			}

			if (probe.repo.kind === 'not-a-repo') {
				setState(edge('not-a-repo'));
				return { status: 'ok' };
			}

			if (probe.repo.kind === 'bare') {
				setState(edge('bare'));
				return { status: 'ok' };
			}

			const { root } = probe.repo;
			const status = await readStatus({ cwd: root });

			if (!isCurrent()) {
				return { status: 'superseded' };
			}

			const view = mapStatus(status);
			setState({
				kind: 'repo',
				root,
				branch: view.branch,
				workingFiles: view.workingFiles,
				fileGroups: view.fileGroups,
				identity: probe.identity,
				detail: undefined,
			});
			return { status: 'ok' };
		} catch (error: unknown) {
			if (!isCurrent()) {
				return { status: 'superseded' };
			}

			if (error instanceof GitNotFoundError) {
				setState(edge('git-not-found'));
				return {
					status: 'failed',
					summary: 'git not found',
					error: toGitError(error),
				};
			}

			const message = error instanceof Error ? error.message : String(error);
			setState(edge('error', message));
			return {
				status: 'failed',
				summary: message,
				error: toGitError(error),
			};
		}
	}, []);

	useEffect(() => {
		mountedRef.current = true;
		void load();

		return () => {
			// A late resolve must not set state after unmount.
			mountedRef.current = false;
		};
	}, [load]);

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
	 * Drain the queue serially, then refresh once.
	 *
	 * Each action already reads git's own result, so a refresh per run would
	 * only multiply git calls; the panel needs the final state, nothing in
	 * between. Runs queued while that refresh is in flight start another drain.
	 */
	const drain = useCallback(async (): Promise<void> => {
		if (isDrainingRef.current) {
			return;
		}

		isDrainingRef.current = true;

		try {
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

				// eslint-disable-next-line no-await-in-loop -- one refresh per drain, after the last run
				await load();

				if (queueRef.current.length === 0) {
					break;
				}
			}
		} finally {
			isDrainingRef.current = false;
		}
	}, [load, runQueued]);

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
	 */
	const failedOperation = useMemo<OperationLogEntry | undefined>(() => {
		for (let index = entries.length - 1; index >= 0; index -= 1) {
			const entry = entries[index];
			if (entry === undefined) {
				continue;
			}

			if (entry.status === 'failed') {
				return entry;
			}

			if (entry.kind === 'git') {
				return undefined;
			}
		}

		return undefined;
	}, [entries]);

	/**
	 * Run at most one manual refresh at a time, with a single pending slot.
	 *
	 * Repeated `r` presses must not each spawn a `git status` chain; a press
	 * while one is running only asks for one more after it finishes, and any
	 * number of presses in that window collapse into that one request. Each
	 * actual run logs its own entry and its real outcome, including a load that
	 * a newer request superseded.
	 */
	const runRefresh = useCallback(async (): Promise<void> => {
		if (isRefreshingRef.current) {
			return;
		}

		isRefreshingRef.current = true;

		try {
			while (refreshPendingRef.current && mountedRef.current) {
				refreshPendingRef.current = false;
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
				const outcome = await load();

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
		}
	}, [load]);

	const refresh = useCallback(() => {
		refreshPendingRef.current = true;
		void runRefresh();
	}, [runRefresh]);

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
