import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GitError, GitNotFoundError, type GitResult } from '../git/exec.js';
import {
	diffSourceOf,
	readFileDiff,
	readWorkingFileStats,
	type DiffStat,
} from '../git/diff.js';
import { resolveRepoInfo, type Identity } from '../git/repo-info.js';
import { readLog, readRefsFingerprint } from '../git/log.js';
import { readStatus, readUnmergedPaths } from '../git/status.js';
import {
	discardTracked as discardTrackedPaths,
	discardUntracked as discardUntrackedPaths,
	recreateConflict as recreateConflictPaths,
	stage as stagePaths,
	unstage as unstagePaths,
	type WorkingTreePaths,
} from '../git/working-tree.js';
import { commit as commitPaths, type CommitOptions } from '../git/commit.js';
import {
	checkout as checkoutBranch,
	createBranch as createBranchAtHead,
} from '../git/branch.js';
import { readRefs } from '../git/refs.js';
import { failureSummary } from '../git/errors.js';
import {
	remoteCommands,
	runCommand as runRemoteCommand,
	type RemoteCommandId,
} from '../git/remote.js';
import { mapStatus } from '../data/map.js';
import {
	categoryOf,
	type BranchSync,
	type Commit,
	type DiffLine,
	type FileGroup,
	type SidebarSection,
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
 * Live progress of a running remote command.
 *
 * `phase` is required because a parsed percentage always arrives with the
 * phase line that carried it; `done`/`total` are optional because a phase
 * line such as `Enumerating objects: 5, done.` has no counts.
 */
export type OperationProgress = {
	readonly phase: string;
	readonly percent?: number;
	readonly done?: number;
	readonly total?: number;
};

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
	/**
	 * Streamed phase progress while the entry is running. Cleared when the run
	 * finishes: a finished row shows its duration and outcome, not a stale bar.
	 */
	readonly progress?: OperationProgress;
};

/** Whether the queue is running something, and its present-tense label. */
export type OperationState = {
	readonly busy: boolean;
	readonly label: string;
	/** Live progress of the running entry, when it has any. */
	readonly progress?: OperationProgress;
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
	/**
	 * True while `MERGE_HEAD` exists in this worktree's git dir, including the
	 * resolved-but-uncommitted state where no unmerged path remains.
	 */
	readonly mergeInProgress: boolean;
	readonly branch: string;
	/** How the checked-out branch relates to its upstream, for the badge. */
	readonly sync: BranchSync;
	/** Every sidebar section, read from refs on each successful load. */
	readonly sections: readonly SidebarSection[];
	readonly workingFiles: readonly WorkingFile[];
	readonly fileGroups: readonly FileGroup[];
	/**
	 * HEAD's history, newest first, with the pending pseudo-commit on top.
	 * Empty outside a normal worktree view.
	 */
	readonly commits: readonly Commit[];
	readonly identity: Identity | undefined;
	/** Failure detail for the `error` kind; undefined otherwise. */
	readonly detail: string | undefined;
	/** The state the commit panel renders and acts through. */
	readonly workingTree: WorkingTree;
	/** Index of the selected row in `commits`, for the list's highlight. */
	readonly selectedCommit: number;
	/**
	 * Select a commit by hash; a hash that is not in the current list is
	 * ignored, because a stale click must not point the highlight at a row
	 * that no longer exists.
	 */
	selectCommit: (hash: string) => void;
	readonly operation: OperationState;
	/**
	 * Short notice for a remote command that was ignored because the queue was
	 * busy. Transient: it clears after a few seconds so the status line cannot
	 * keep claiming a conflict that is long over.
	 */
	readonly busyHint: string | undefined;
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
	/** Load a row's diff on demand; no-op when cached or already in flight. */
	ensureDiff: (path: string) => void;
	/**
	 * Commit the staged index; resolves false when there is no repository
	 * root, the message is empty, the index is empty, or git rejects the
	 * commit. Rejections still land in the operation log and the error overlay.
	 */
	commit: (message: string, options?: CommitOptions) => Promise<boolean>;
	/**
	 * Switch to an existing branch. Resolves the failed log entry so the app
	 * can open the error overlay with git's real message, or undefined when the
	 * switch succeeded.
	 */
	checkout: (name: string) => Promise<OperationLogEntry | undefined>;
	/**
	 * Validate a name, create the branch at HEAD, and switch to it. Same
	 * failure contract as `checkout`: a rejected name never reaches the
	 * worktree and the app receives the entry that explains why.
	 */
	createBranch: (name: string) => Promise<OperationLogEntry | undefined>;
	/**
	 * Run one remote operation through the queue. Resolves undefined when the
	 * command succeeded or was ignored because another operation was running;
	 * a failed entry otherwise, so the app can open the error overlay.
	 */
	runCommand: (id: RemoteCommandId) => Promise<OperationLogEntry | undefined>;
};

type RepoSnapshot = Omit<
	RepoState,
	| 'workingTree'
	| 'selectedCommit'
	| 'selectCommit'
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
	| 'ensureDiff'
	| 'commit'
	| 'checkout'
	| 'createBranch'
	| 'runCommand'
> & {
	/**
	 * The selected commit's hash, kept in the snapshot rather than exposed as
	 * an index so a refresh can re-resolve it against the newest list.
	 */
	readonly selectedCommitHash: string | undefined;
};

/** Entries kept in the ring buffer; older runs fall off the front. */
const operationLogCap = 200;

/**
 * How often a running entry adopts streamed progress.
 *
 * A large fetch emits thousands of CR-framed updates; forwarding each one
 * would re-render the whole Ink tree. Coalescing to about ten updates per
 * second keeps the bar alive without making the UI the bottleneck.
 */
const progressThrottleMs = 100;

/** How long an ignored-while-busy notice stays on the status line. */
const busyHintDurationMs = 3000;

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
	mergeInProgress: false,
	branch: '',
	sync: { state: 'unknown', upstream: undefined, ahead: 0, behind: 0 },
	sections: [],
	workingFiles: [],
	fileGroups: [],
	commits: [],
	selectedCommitHash: undefined,
	identity: undefined,
	detail,
	busyHint: undefined,
});

/**
 * The pseudo-commit that stands for the uncommitted working tree.
 *
 * Its count is the number of status entries, which is exactly what
 * `git status --short | wc -l` prints. The hash is a stable literal rather
 * than a real oid, so the pending row can be selected and keeps its highlight
 * like any other row. It carries no file or line stats because nothing is
 * committed yet.
 */
const pendingCommit = (count: number): Commit => ({
	hash: 'pending',
	message: `${count} changed file${count === 1 ? '' : 's'}`,
	author: 'Commit Changes',
	date: '',
	tags: [],
	parents: [],
	pending: true,
});

/**
 * Re-resolve the selected hash against a freshly read commit list.
 *
 * Comparing hashes rather than an index is what keeps the highlight on the
 * same commit when a refresh lands a new row on top. On the first load the
 * pending row is selected, because the working tree is what the user is about
 * to act on. A stored hash that is still present wins; a vanished one (rebase,
 * reset, fetch) falls back to the newest real commit, or to the pending row
 * when the repository has no commits yet, so the list is never left with
 * nothing selected.
 */
const nextSelectedHash = (
	commits: readonly Commit[],
	previous: string | undefined,
): string | undefined => {
	if (previous === undefined) {
		return commits[0]?.hash;
	}

	if (commits.some(commit => commit.hash === previous)) {
		return previous;
	}

	const newest = commits.find(commit => commit.pending !== true);
	return newest?.hash ?? commits[0]?.hash;
};

/** The last log read plus the state that still makes it current. */
type CommitsCache = {
	readonly root: string;
	readonly headOid: string;
	readonly branch: string;
	readonly fingerprint: string;
	readonly commits: readonly Commit[];
};

type MutationVerb = 'stage' | 'unstage' | 'discard' | 'recreate-conflict';

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
	'recreate-conflict': {
		busy: 'recreating conflict in',
		done: 'recreated conflict in',
	},
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
 * The failed entry a branch action returns, or undefined on success.
 *
 * Returning the entry lets the app open the error overlay with git's real
 * output, which a boolean could not carry.
 */
const failureOf = (entry: OperationLogEntry): OperationLogEntry | undefined =>
	entry.status === 'ok' ? undefined : entry;

/**
 * Keep the last streamed phase in a failed remote run's summary.
 *
 * A transport failure often ends with output that says nothing about where it
 * happened (`fatal: the remote end hung up unexpectedly`). Naming the phase
 * tells the user whether the connection died while receiving objects or while
 * writing them; a run with no progress (local mutations) is unchanged.
 */
const failureSummaryDuring = (
	error: GitError,
	phase: string | undefined,
): string => {
	const summary = failureSummary(error);
	return phase === undefined ? summary : `${summary} (during ${phase})`;
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
 * What makes a cached diff stale.
 *
 * The row's identity is everything the diff command would read: the status
 * letter, which side is staged, whether the worktree also differs (it changes
 * the task), the numstat counts, the binary marker, and the resulting diff
 * source. Comparing this again after a refresh is what turns a background
 * `git add` or a second-terminal edit into a reload instead of a stale view.
 */
const diffSignature = (file: WorkingFile): string =>
	[
		file.status,
		file.staged ? '1' : '0',
		file.hasUnstaged ? '1' : '0',
		file.additions,
		file.deletions,
		file.binary ? '1' : '0',
		diffSourceOf(file),
	].join(':');

type CachedDiff = {
	readonly signature: string;
	readonly diff: readonly DiffLine[];
};

/** Identity token for one read, so a stale read cannot clear a newer one. */
type InFlightDiff = {
	readonly signature: string;
};

const noStat: DiffStat = { additions: 0, deletions: 0, binary: false };

/**
 * Apply numstat counts to a fresh status snapshot and reattach valid diffs.
 *
 * Cached diffs survive a refresh only while the row's signature still matches;
 * a changed row drops its diff so the next expansion reads the new state, and a
 * vanished path loses its cache entry entirely. A failed diff read is cached as
 * a header note under the same signature, so it needs no special case here.
 */
const withWorkingStats = (
	files: readonly WorkingFile[],
	stats: ReadonlyMap<string, DiffStat>,
	cache: Map<string, CachedDiff>,
): readonly WorkingFile[] => {
	const present = new Set<string>();

	const next: WorkingFile[] = files.map(file => {
		const annotated: WorkingFile = {
			...file,
			...(stats.get(file.path) ?? noStat),
		};
		const signature = diffSignature(annotated);
		const cached = cache.get(file.path);
		present.add(file.path);

		if (cached !== undefined && cached.signature !== signature) {
			cache.delete(file.path);
		}

		return {
			...annotated,
			diff: cached?.signature === signature ? cached.diff : [],
		};
	});

	for (const path of cache.keys()) {
		if (!present.has(path)) {
			cache.delete(path);
		}
	}

	return next;
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
	/**
	 * Past-tense summary recorded when the run succeeds, or a resolver for a
	 * run that decides after reading git what it actually changed (for example
	 * an unstage that skips paths the authoritative index reports unmerged).
	 */
	readonly summary: string | ((results: readonly GitResult[]) => string);
	/**
	 * `reportCommand` receives each command's argv as soon as it completes, so
	 * a run that fails partway still knows which earlier commands succeeded.
	 * `reportProgress` receives streamed phase updates while the command runs;
	 * a run that has none simply ignores it.
	 */
	readonly run: (
		reportCommand: (args: readonly string[]) => void,
		reportProgress: (progress: OperationProgress) => void,
	) => Promise<readonly GitResult[]>;
	/**
	 * Resolve the promise `enqueue` returned. A caller that shows its own
	 * result (the commit message clearing only on success, a branch failure
	 * opening the error overlay) needs the finished entry, not just a boolean.
	 */
	readonly settle: (entry: OperationLogEntry) => void;
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
	/**
	 * Paths that were unmerged at some point during the current merge.
	 *
	 * `MERGE_HEAD` says a merge is in progress; this set remembers which paths
	 * it touched. A path resolved with `git add` no longer appears as unmerged,
	 * but it is still merge-origin: plain unstaging would silently drop its
	 * unresolved stages, so only `git checkout -m` may undo it. The set is
	 * cleared as soon as `MERGE_HEAD` disappears.
	 */
	const mergeOriginPathsRef = useRef<Set<string>>(new Set());
	/**
	 * Parsed diffs, keyed by path and guarded by the signature they describe.
	 *
	 * Expansion is lazy and repeated: collapsing and reopening a row must not
	 * spawn another git command, and an untouched row may keep its diff across
	 * every status refresh. The signature is what makes that safe.
	 */
	const diffCacheRef = useRef<Map<string, CachedDiff>>(new Map());
	/**
	 * Reads currently running, keyed by path.
	 *
	 * A row can be expanded again after a refresh changed it while the previous
	 * read is still running, so the entry is an identity token: the older read
	 * may only clear its own marker, never the newer request's.
	 */
	const diffInFlightRef = useRef<Map<string, InFlightDiff>>(new Map());
	/**
	 * The last log read, keyed by the state that still makes it current.
	 *
	 * A refresh re-reads the log only when the key moves (root, HEAD oid,
	 * branch label, refs fingerprint): worktree edits keep HEAD and the refs, so
	 * a plain file change never pays the numstat log read; a fetch, tag, or
	 * branch change moves the key and the decoration chips refresh without a
	 * commit. The branch label is part of the key because two branches can
	 * point at the same oid: `%D` then differs while the oid and refs digest
	 * alone would look unchanged.
	 */
	const commitsCacheRef = useRef<CommitsCache | undefined>(undefined);
	/**
	 * The selected commit's hash, outside React state.
	 *
	 * The list is replaced on every refresh, so the selection is tracked by
	 * hash: the ref lets `load` re-resolve it against the fresh list, and a
	 * click updates it together with the state so a refresh landing right
	 * after a click keeps the new selection.
	 */
	const selectedCommitHashRef = useRef<string | undefined>(undefined);
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
	/**
	 * Timer behind `busyHint`. One timer per notice is enough: a second
	 * ignored click replaces the text and restarts the same countdown.
	 */
	const busyHintTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);
	/**
	 * Throttle timer for the running entry's progress.
	 *
	 * Only one run exists at a time, so one timer is enough. Keeping it at
	 * hook level is what lets the unmount cleanup stop it when the app
	 * disappears mid-transfer instead of letting 100 ms ticks continue.
	 */
	const progressTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);

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
	 * Adopt an edge snapshot and drop merge-origin tracking with it.
	 *
	 * Every edge state means no merge survives it, so a stale set must not
	 * leak into the next repository view. The cleanup lives here rather than in
	 * a `setState` updater because updaters must stay pure; a load that keeps
	 * the last good repository view deliberately does not call this, so the
	 * tracked paths behind the rendered rows survive a transient failure.
	 */
	const adoptEdge = useCallback((next: RepoSnapshot): void => {
		mergeOriginPathsRef.current.clear();
		setState(next);
	}, []);

	/**
	 * Adopt an edge state only when the load owns that transition.
	 *
	 * An initial load, or one already outside a repository, replaces the view;
	 * any other failed load keeps the last good repository view and its
	 * merge-origin tracking. Keeping the decision here means `load`'s catch
	 * path stays a plain call and no `setState` updater carries a side effect.
	 */
	const adoptLoadEdge = useCallback(
		(mode: LoadMode, next: RepoSnapshot): void => {
			if (mode === 'initial' || stateRef.current.kind !== 'repo') {
				adoptEdge(next);
			}
		},
		[adoptEdge],
	);

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

	/**
	 * Read HEAD's history, reusing the last read unless the log key moved.
	 *
	 * The key is the root, HEAD's oid, the status branch label, and a
	 * fingerprint of every ref, so a worktree-only refresh pays one cheap
	 * `for-each-ref` and skips the expensive numstat log entirely. The branch
	 * label distinguishes two branches that share an oid, whose `%D`
	 * decorations differ even when the refs digest does not. An unborn HEAD has
	 * no history to read and `git log` would fail on it, so that case is an
	 * empty list.
	 */
	const readCommits = useCallback(
		async (
			root: string,
			headOid: string | undefined,
			branch: string,
		): Promise<readonly Commit[]> => {
			if (headOid === undefined) {
				return [];
			}

			const fingerprint = await readRefsFingerprint({ cwd: root });
			const cached = commitsCacheRef.current;

			if (
				cached !== undefined &&
				cached.root === root &&
				cached.headOid === headOid &&
				cached.branch === branch &&
				cached.fingerprint === fingerprint
			) {
				return cached.commits;
			}

			const commits = await readLog({ cwd: root });
			commitsCacheRef.current = {
				root,
				headOid,
				branch,
				fingerprint,
				commits,
			};
			return commits;
		},
		[],
	);

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

					// An adopted edge state has no merge any more; a stale set must
					// not survive into the next repository view.
					adoptEdge(edge('not-a-repo'));
					markApplied();
					return { status: 'ok' };
				}

				if (probe.repo.kind === 'bare') {
					if (isAutomaticLoad(mode) && stateRef.current.kind === 'repo') {
						return probeFailure('repository is now bare');
					}

					adoptEdge(edge('bare'));
					markApplied();
					return { status: 'ok' };
				}

				const { root, commonDir, gitDir } = probe.repo;
				/*
				 * `MERGE_HEAD` is the one file that says a merge is still open,
				 * even after every path is resolved: until the merge commit
				 * exists the branch is not clean. It lives in the per-worktree
				 * git dir, so a linked worktree reads its own merge state.
				 */
				const mergeInProgress = fs.existsSync(path.join(gitDir, 'MERGE_HEAD'));
				const status = await readStatus({ cwd: root });

				if (!isCurrent()) {
					return { status: 'superseded' };
				}

				/*
				 * Accumulate every path this merge ever left unmerged in a
				 * local set. Once a path is resolved it leaves the status
				 * stream, but its staging history cannot be undone with a plain
				 * restore; the set is dropped only when the merge ends. Keeping
				 * the next set local until the load applies means a later read
				 * (stats, refs) or a superseding load cannot leave tracking
				 * ahead of the view it explains.
				 */
				const nextMergeOriginPaths = new Set<string>();
				if (mergeInProgress) {
					for (const path of mergeOriginPathsRef.current) {
						nextMergeOriginPaths.add(path);
					}

					for (const entry of status.entries) {
						if (entry.kind === 'unmerged') {
							nextMergeOriginPaths.add(entry.path);
						}
					}
				}

				const view = mapStatus(status, mergeInProgress);
				/*
				 * Status stats are always needed; the log read runs only when
				 * its key moved, so both are awaited together and a
				 * worktree-only refresh skips the expensive numstat read. The
				 * sidebar refs are small read-only reads and refresh together
				 * with status so an external branch, tag, or stash change is
				 * visible on the next load.
				 */
				const [stats, logCommits, sections] = await Promise.all([
					readWorkingFileStats({
						cwd: root,
						files: view.workingFiles,
					}),
					readCommits(root, status.branch.oid, view.branch),
					readRefs({
						cwd: root,
						currentBranch:
							status.branch.kind === 'branch' ? status.branch.name : undefined,
					}),
				]);

				if (!isCurrent()) {
					return { status: 'superseded' };
				}

				const workingFiles = withWorkingStats(
					view.workingFiles,
					stats,
					diffCacheRef.current,
				);

				// The pending row counts real status entries, so it matches
				// `git status --short | wc -l` exactly, collapsed untracked
				// directories included.
				const commits: readonly Commit[] = [
					pendingCommit(status.entries.length),
					...logCommits,
				];
				const selectedCommitHash = nextSelectedHash(
					commits,
					selectedCommitHashRef.current,
				);
				selectedCommitHashRef.current = selectedCommitHash;

				// Keep `ensureDiff` and the actions in sync before React renders:
				// a diff resolving in this window must compare against the new
				// signature, not the previous snapshot's. The merge-origin set
				// commits here too, with the view it describes: every earlier
				// failure path leaves the previous ref untouched.
				mergeOriginPathsRef.current = nextMergeOriginPaths;
				filesRef.current = workingFiles;
				setState(current => ({
					kind: 'repo',
					root,
					watchDir: commonDir,
					// Degradation is owned by the watcher effect, not by a reload:
					// carrying it through here keeps the hint until a watch is live.
					watchDegraded: current.watchDegraded,
					mergeInProgress,
					branch: view.branch,
					sync: view.sync,
					sections,
					workingFiles,
					fileGroups: view.fileGroups,
					commits,
					selectedCommitHash,
					identity: probe.identity,
					detail: undefined,
					// A load does not resolve a busy notice: its own timer does,
					// and a post-drain load must not make the hint vanish early.
					busyHint: current.busyHint,
				}));
				markApplied();
				return { status: 'ok' };
			} catch (error: unknown) {
				if (!isCurrent()) {
					return { status: 'superseded' };
				}

				/*
				 * Only an initial load or a load already outside a repository
				 * adopts an edge state; a reload that fails keeps the last good
				 * view. Adoption also clears merge-origin tracking, which
				 * cannot describe a view with no repository.
				 */
				if (error instanceof GitNotFoundError) {
					adoptLoadEdge(mode, edge('git-not-found'));
					return {
						status: 'failed',
						summary: 'git not found',
						error: toGitError(error),
					};
				}

				const message = error instanceof Error ? error.message : String(error);
				const gitError = toGitError(error);
				adoptLoadEdge(mode, edge('error', message));
				return {
					status: 'failed',
					// The log and status line show this, so prefer git's own line
					// ("index file corrupt") over the argv-only error message.
					summary: failureSummary(gitError),
					error: gitError,
				};
			}
		},
		[cancelWatchRetry, readCommits, adoptEdge, adoptLoadEdge],
	);

	useEffect(() => {
		mountedRef.current = true;
		void load('initial');

		return () => {
			// A late resolve must not set state after unmount.
			mountedRef.current = false;
			cancelWatchRetry();
			if (busyHintTimerRef.current !== undefined) {
				clearTimeout(busyHintTimerRef.current);
				busyHintTimerRef.current = undefined;
			}

			if (progressTimerRef.current !== undefined) {
				clearTimeout(progressTimerRef.current);
				progressTimerRef.current = undefined;
			}
		};
	}, [cancelWatchRetry, load]);

	/**
	 * Load one row's diff the first time it expands.
	 *
	 * This is deliberately outside the operation queue: a read that the user
	 * asked for by expanding a row must not wait behind a stage or commit, and
	 * it mutates nothing. The signature checks on both sides of the read keep a
	 * status refresh from being overwritten by a slower, older diff: a result
	 * only lands if the exact row it was read for is still the current one. A
	 * failure becomes a cached header row, so reopening the file explains the
	 * problem instead of retrying a broken command on every render.
	 */
	const ensureDiff = useCallback((path: string): void => {
		const { root } = stateRef.current;
		if (root === undefined) {
			return;
		}

		const file = filesRef.current.find(item => item.path === path);
		if (file === undefined) {
			return;
		}

		const signature = diffSignature(file);
		if (diffCacheRef.current.get(path)?.signature === signature) {
			return;
		}

		if (diffInFlightRef.current.get(path)?.signature === signature) {
			return;
		}

		const token: InFlightDiff = { signature };
		diffInFlightRef.current.set(path, token);

		const apply = (diff: readonly DiffLine[]): void => {
			if (!mountedRef.current) {
				return;
			}

			const current = filesRef.current.find(item => item.path === path);
			if (current === undefined || diffSignature(current) !== signature) {
				// The row changed while git was reading. Its new state will ask
				// for its own diff when it renders; this result is history.
				return;
			}

			diffCacheRef.current.set(path, { signature, diff });
			setState(state => {
				// The updater sees the freshest snapshot, which closes the
				// window between a load computing files and React applying it.
				const target = state.workingFiles.find(item => item.path === path);
				if (target === undefined || diffSignature(target) !== signature) {
					return state;
				}

				return {
					...state,
					workingFiles: state.workingFiles.map(item =>
						item.path === path ? { ...item, diff } : item,
					),
				};
			});
		};

		void readFileDiff({ cwd: root, file })
			.then(apply)
			.catch((error: unknown) => {
				// A read, not an operation: report in the row rather than in the
				// log or the error overlay, and cache it so repeated expansion
				// cannot retry-storm a command that is going to keep failing.
				const summary = failureSummary(toGitError(error));
				apply([
					{
						kind: 'header',
						oldNumber: undefined,
						newNumber: undefined,
						text: `diff unavailable: ${summary}`,
					},
				]);
			})
			.finally(() => {
				if (diffInFlightRef.current.get(path) === token) {
					diffInFlightRef.current.delete(path);
				}
			});
	}, []);

	/** Drop a transient busy notice and its countdown. */
	const clearBusyHint = useCallback((): void => {
		if (busyHintTimerRef.current !== undefined) {
			clearTimeout(busyHintTimerRef.current);
			busyHintTimerRef.current = undefined;
		}

		setState(current =>
			current.busyHint === undefined
				? current
				: { ...current, busyHint: undefined },
		);
	}, []);

	/**
	 * Say why a remote command was ignored while the queue was busy.
	 *
	 * The running operation keeps the status line, so the rejected request
	 * needs its own line; the timer clears it before it can look like the
	 * current state long after the queue became free.
	 */
	const showBusyHint = useCallback((hint: string): void => {
		if (!mountedRef.current) {
			return;
		}

		if (busyHintTimerRef.current !== undefined) {
			clearTimeout(busyHintTimerRef.current);
		}

		setState(current => ({ ...current, busyHint: hint }));
		busyHintTimerRef.current = setTimeout(() => {
			busyHintTimerRef.current = undefined;
			if (!mountedRef.current) {
				return;
			}

			setState(current =>
				current.busyHint === hint
					? { ...current, busyHint: undefined }
					: current,
			);
		}, busyHintDurationMs);
	}, []);

	/** Run one queued operation and record its outcome in the log. */
	const runQueued = useCallback(
		async (queued: QueuedRun): Promise<void> => {
			const entry: OperationLogEntry = {
				id: queued.id,
				kind: 'git',
				label: queued.label,
				args: [],
				startedAt: Date.now(),
				status: 'running',
			};

			// A queued run starting means the busy window that produced any
			// hint has ended; the notice must not overlap a real operation.
			clearBusyHint();

			// A queued run gets no entry until it starts, so the status line only
			// ever shows the running one; the console records the same start.
			setEntries(current => [...current, entry].slice(-operationLogCap));

			const completedArgs: string[][] = [];
			let finished: OperationLogEntry;
			/** Latest state received from the stream, even when not yet shown. */
			let latestProgress: OperationProgress | undefined;
			/** The state the running entry currently renders. */
			let shownProgress: OperationProgress | undefined;

			const clearProgressTimer = (): void => {
				if (progressTimerRef.current !== undefined) {
					clearTimeout(progressTimerRef.current);
					progressTimerRef.current = undefined;
				}
			};

			/**
			 * Adopt the newest pending state. Done/total-only movement is
			 * skipped by the same phase+percent key the reporter uses, so a
			 * transfer that has not moved a percentage for a while does not
			 * re-render on every object.
			 */
			const flushProgress = (): void => {
				progressTimerRef.current = undefined;
				if (latestProgress === undefined) {
					return;
				}

				if (
					shownProgress !== undefined &&
					shownProgress.phase === latestProgress.phase &&
					shownProgress.percent === latestProgress.percent
				) {
					return;
				}

				const next = latestProgress;
				shownProgress = next;
				if (!mountedRef.current) {
					return;
				}

				setEntries(current =>
					current.map(item =>
						item.id === entry.id && item.status === 'running'
							? { ...item, progress: next }
							: item,
					),
				);
			};

			const reportProgress = (progress: OperationProgress): void => {
				latestProgress = progress;

				if (
					shownProgress !== undefined &&
					shownProgress.phase === progress.phase &&
					shownProgress.percent === progress.percent
				) {
					return;
				}

				// One pending timer is the whole throttle: the first update
				// schedules a flush and later updates ride on it.
				if (progressTimerRef.current === undefined) {
					progressTimerRef.current = setTimeout(
						flushProgress,
						progressThrottleMs,
					);
				}
			};

			try {
				const results = await queued.run(args => {
					completedArgs.push([...args]);
				}, reportProgress);
				finished = {
					...entry,
					// Every git command the run spawned, in order (chunked runs have
					// one per chunk); each argv carries the global flags already.
					args: results.map(result => result.args),
					endedAt: Date.now(),
					status: 'ok',
					summary:
						typeof queued.summary === 'function'
							? queued.summary(results)
							: queued.summary,
				};
			} catch (error: unknown) {
				const gitError = toGitError(error);
				finished = {
					...entry,
					// Keep the chunks that completed before the failing command, so
					// a failed chunked run shows the same "(+N more)" history as a
					// successful one; the failing argv comes from the error itself.
					// A synthetic error (local validation, no command run) has no
					// argv and must not add a blank command to the log.
					args:
						gitError.args.length > 0
							? [...completedArgs, gitError.args]
							: [...completedArgs],
					endedAt: Date.now(),
					status: 'failed',
					// The phase is the last thing the stream said before the
					// failure; it tells the user where the transport died.
					summary: failureSummaryDuring(gitError, latestProgress?.phase),
					error: gitError,
				};
			} finally {
				// The finished entry carries no progress; a late timer must not
				// resurrect a bar over a completed row.
				clearProgressTimer();
			}

			// Settle before the unmount check: the caller is awaiting this outcome
			// even when the component disappeared while git was running.
			queued.settle(finished);

			if (!mountedRef.current) {
				return;
			}

			setEntries(current =>
				current.map(item => (item.id === entry.id ? finished : item)),
			);
		},
		[clearBusyHint],
	);

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
		async (
			label: string,
			summary: QueuedRun['summary'],
			run: QueuedRun['run'],
		): Promise<OperationLogEntry> => {
			nextIdRef.current += 1;
			const outcome = new Promise<OperationLogEntry>(resolve => {
				queueRef.current.push({
					id: nextIdRef.current,
					label,
					summary,
					run,
					settle: resolve,
				});
			});
			void drain();
			return outcome;
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
			void enqueue(busy, done, async reportCommand =>
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

	/**
	 * Enqueue a plain unstage that first re-reads the authoritative index.
	 *
	 * The rendered snapshot cannot decide this: an external `git add`, merge, or
	 * checkout can make a path unmerged after the last load, and
	 * `git restore --staged` on such a path drops its stages irreversibly.
	 * Reading `ls-files -u` inside the queued run serializes the check with the
	 * destructive command; a currently unmerged path has nothing staged, so
	 * skipping it is safe. No command runs when the filter leaves nothing.
	 */
	const enqueuePlainUnstage = useCallback(
		(paths: readonly string[]) => {
			const cwd = stateRef.current.root;
			if (cwd === undefined || paths.length === 0) {
				return;
			}

			let applied: readonly string[] = paths;
			const { busy } = mutationLabels('unstage', paths);
			void enqueue(
				busy,
				() =>
					applied.length === 0
						? 'nothing to unstage'
						: mutationLabels('unstage', applied).done,
				async reportCommand => {
					const unmerged = await readUnmergedPaths({ cwd });
					applied = paths.filter(path => !unmerged.has(path));

					if (applied.length === 0) {
						return [];
					}

					return unstagePaths({
						cwd,
						paths: applied,
						onCommand: reportCommand,
					});
				},
			);
		},
		[enqueue],
	);

	/**
	 * Unstage the staged paths among `paths`, splitting by merge origin.
	 *
	 * The snapshot filters out rows the index does not hold staged, but it is
	 * not the authority for a destructive command: the queued plain unstage
	 * re-reads unmerged paths immediately before `git restore --staged`. A
	 * staged merge-origin path must never reach that command; while
	 * `MERGE_HEAD` exists it is routed to `checkout -m` instead. The same
	 * current merge state gates the label, so action and label cannot disagree
	 * after a merge ends.
	 */
	const unstageStaged = useCallback(
		(paths: readonly string[]) => {
			const staged = new Set(
				filesRef.current.filter(file => file.staged).map(file => file.path),
			);
			const target = paths.filter(path => staged.has(path));

			if (target.length === 0) {
				return;
			}

			const { mergeInProgress } = stateRef.current;
			const mergeOrigin = mergeInProgress
				? target.filter(path => mergeOriginPathsRef.current.has(path))
				: [];
			const mergeOriginSet = new Set(mergeOrigin);
			const plain = target.filter(path => !mergeOriginSet.has(path));

			enqueuePlainUnstage(plain);

			if (mergeOrigin.length > 0) {
				runMutation('recreate-conflict', mergeOrigin, recreateConflictPaths);
			}
		},
		[enqueuePlainUnstage, runMutation],
	);

	const unstage = useCallback(
		(paths: readonly string[]) => {
			unstageStaged(paths);
		},
		[unstageStaged],
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

			// A conflicted path has no resolved side to restore: the worktree
			// file holds the only copy of the conflict, and a programmatic
			// caller must not be able to discard it.
			if (categoryOf(file) === 'conflicted') {
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

	/**
	 * Unstage a category's plain staged paths, never its merge-origin ones.
	 *
	 * Bulk unstage is not a conflict action: including a resolved merge path
	 * would silently rebuild its conflict and throw away the staged resolution.
	 * Those rows keep their explicit `Recreate Conflict` action instead, and
	 * the group header only offers this one when every staged path is plain.
	 * The filter below stays as a defense: a programmatic caller must not be
	 * able to smuggle a merge-origin path into the bulk path.
	 */
	const unstageAll = useCallback(
		(category: WorkingGroupCategory) => {
			const { mergeInProgress } = stateRef.current;
			const mergeOrigin = mergeInProgress
				? mergeOriginPathsRef.current
				: undefined;
			const paths = bulkPaths(
				category,
				file => file.staged && !(mergeOrigin?.has(file.path) ?? false),
			);

			enqueuePlainUnstage(paths);
		},
		[bulkPaths, enqueuePlainUnstage],
	);

	const discardAll = useCallback(
		(category: WorkingGroupCategory) => {
			// Conflicts never expose a bulk discard; refusing the category here
			// also stops a programmatic caller from bypassing the UI.
			if (category === 'conflicted') {
				return;
			}

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

	/**
	 * Record a validation failure that never reached git.
	 *
	 * The status line and the error overlay both read the same entry, so a
	 * rejected commit is explained in both places: the summary is the status
	 * line's one line, and the synthetic `GitError` gives the overlay its
	 * stderr. No argv and no exit code, because nothing ran.
	 */
	const recordFailure = useCallback(
		(label: string, summary: string): OperationLogEntry => {
			nextIdRef.current += 1;
			const entry: OperationLogEntry = {
				id: nextIdRef.current,
				kind: 'git',
				label,
				args: [],
				startedAt: Date.now(),
				endedAt: Date.now(),
				status: 'failed',
				summary,
				error: new GitError(
					{ args: [], exitCode: undefined, stdout: '', stderr: summary },
					summary,
				),
			};

			setEntries(current => [...current, entry].slice(-operationLogCap));
			return entry;
		},
		[],
	);

	/**
	 * Commit the staged index after checking the local preconditions git would
	 * reject with a less useful message. Validation is local so the status line
	 * can say exactly what is missing, and it never queues work that cannot run.
	 * The order matches the commit hint: no repository, then nothing staged,
	 * then an empty message. An unresolved merge is deliberately left to git:
	 * `git commit` already refuses it, and the classifier turns that into the
	 * actionable "unmerged files" summary instead of a misleading staged count.
	 */
	const commit = useCallback(
		async (message: string, options: CommitOptions = {}): Promise<boolean> => {
			// Read through the ref, not a render closure: the commit must act
			// on the snapshot the panel is showing.
			const { root, workingFiles } = stateRef.current;
			const stagedCount = workingFiles.filter(file => file.staged).length;
			const hasConflicts = workingFiles.some(
				file => file.status === 'conflicted',
			);

			if (root === undefined) {
				recordFailure('commit', 'not in a repository');
				return false;
			}

			if (stagedCount === 0 && !hasConflicts) {
				recordFailure('commit', 'nothing staged to commit');
				return false;
			}

			if (message.trim().length === 0) {
				recordFailure('commit', 'commit message is empty');
				return false;
			}

			const summary = `committed ${stagedCount} file${
				stagedCount === 1 ? '' : 's'
			}`;

			const entry = await enqueue(
				'committing',
				summary,
				async reportCommand => {
					const result = await commitPaths({
						cwd: root,
						message,
						options: { noVerify: options.noVerify === true },
					});
					reportCommand(result.args);
					return [result];
				},
			);
			return entry.status === 'ok';
		},
		[enqueue, recordFailure],
	);

	/**
	 * Switch to an existing branch.
	 *
	 * The switch runs through the same queue as every other mutation, so it
	 * cannot race a stage or commit, and the drain's post-run load refreshes
	 * the badge, the branch list, and the worktree from git's real result.
	 */
	const checkout = useCallback(
		async (name: string): Promise<OperationLogEntry | undefined> => {
			const { root } = stateRef.current;
			if (root === undefined) {
				return recordFailure('checkout', 'not in a repository');
			}

			const entry = await enqueue(
				`switching to ${name}`,
				`switched to ${name}`,
				async reportCommand => {
					const result = await checkoutBranch({
						cwd: root,
						name,
						onCommand: reportCommand,
					});
					return [result];
				},
			);
			return failureOf(entry);
		},
		[enqueue, recordFailure],
	);

	/**
	 * Create a branch at HEAD and switch to it.
	 *
	 * Validation lives in `git/branch.ts`; a rejected name still lands in the
	 * operation log, so the status line and the error overlay explain the
	 * failure exactly like a dirty-tree checkout rejection does.
	 */
	const createBranch = useCallback(
		async (name: string): Promise<OperationLogEntry | undefined> => {
			const { root } = stateRef.current;
			if (root === undefined) {
				return recordFailure('new branch', 'not in a repository');
			}

			const entry = await enqueue(
				`creating ${name}`,
				`created and switched to ${name}`,
				async reportCommand =>
					createBranchAtHead({
						cwd: root,
						name,
						onCommand: reportCommand,
					}),
			);
			return failureOf(entry);
		},
		[enqueue, recordFailure],
	);

	/**
	 * Run one remote command through the operation queue.
	 *
	 * A request that arrives while the queue is busy is ignored instead of
	 * queued: a second push behind a slow fetch would only race the state the
	 * first one is about to settle. Remote commands get one entry like every
	 * other run, but their streamed progress is attached while it runs and the
	 * last phase is folded into the failure summary when one fails.
	 */
	const runCommand = useCallback(
		async (id: RemoteCommandId): Promise<OperationLogEntry | undefined> => {
			const command = remoteCommands[id];
			// Read through the ref, not a render closure: the command must act
			// on the snapshot the toolbar is showing.
			const { root } = stateRef.current;

			if (root === undefined) {
				return recordFailure(command.busy, 'not in a repository');
			}

			if (isDrainingRef.current || queueRef.current.length > 0) {
				showBusyHint(`${id} ignored: busy`);
				return undefined;
			}

			const entry = await enqueue(
				command.busy,
				command.done,
				async (reportCommand, reportProgress) => {
					const result = await runRemoteCommand(id, {
						cwd: root,
						onCommand: reportCommand,
						onProgress: reportProgress,
					});
					return [result];
				},
			);
			return failureOf(entry);
		},
		[enqueue, recordFailure, showBusyHint],
	);

	/**
	 * Select one commit by hash.
	 *
	 * The hash is validated against the current list, so a click that lands
	 * after a refresh replaced the list cannot point the highlight at a row
	 * that is gone. The ref and the state are updated together, which is what
	 * lets a refresh already in flight re-resolve the newest selection instead
	 * of restoring the previous row.
	 */
	const selectCommit = useCallback((hash: string): void => {
		if (stateRef.current.commits.every(commit => commit.hash !== hash)) {
			return;
		}

		selectedCommitHashRef.current = hash;
		setState(current =>
			current.selectedCommitHash === hash
				? current
				: { ...current, selectedCommitHash: hash },
		);
	}, []);

	/**
	 * The selected row's index, derived from the hash so it always names the
	 * row the list is rendering; an edge snapshot has no commits, so the
	 * clamp to zero only ever shows an empty list.
	 */
	const selectedCommit = useMemo<number>(() => {
		const index = state.commits.findIndex(
			commit => commit.hash === state.selectedCommitHash,
		);
		return index === -1 ? 0 : index;
	}, [state.commits, state.selectedCommitHash]);

	const workingTree = useMemo<WorkingTree>(
		() => ({
			files: state.workingFiles,
			stagedCount: state.workingFiles.filter(file => file.staged).length,
			ensureDiff,
			isStaged(path: string) {
				return state.workingFiles.some(
					file => file.path === path && file.staged,
				);
			},
			isMergeOrigin(path: string) {
				return state.mergeInProgress && mergeOriginPathsRef.current.has(path);
			},
			hasUnstaged(category: WorkingGroupCategory) {
				return state.workingFiles.some(
					file =>
						categoryOf(file) === category && (!file.staged || file.hasUnstaged),
				);
			},
			/**
			 * Whether the category's staged set can be undone as a whole.
			 *
			 * The group header labels this `Unstage All`, so it must appear only when
			 * that promise holds: at least one staged path and all of them plain. A
			 * mixed group would leave its merge-origin rows staged, and those rows
			 * keep their explicit `Recreate Conflict` action instead.
			 */
			hasUnstageable(category: WorkingGroupCategory) {
				const staged = state.workingFiles.filter(
					file => categoryOf(file) === category && file.staged,
				);

				return (
					staged.length > 0 &&
					staged.every(
						file =>
							!(
								state.mergeInProgress &&
								mergeOriginPathsRef.current.has(file.path)
							),
					)
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
			state.mergeInProgress,
			ensureDiff,
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
				return {
					busy: true,
					label: entry.label,
					progress: entry.progress,
				};
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
		selectedCommit,
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
		ensureDiff,
		commit,
		checkout,
		createBranch,
		runCommand,
		selectCommit,
	};
};
