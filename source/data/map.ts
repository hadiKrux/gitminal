import type { RepoStatus, StatusCode, StatusEntry } from '../git/status.js';
import type {
	BranchSync,
	FileCategory,
	FileGroup,
	WorkingFile,
	WorkingFileStatus,
} from './types.js';

/** The working-tree slices of the repo state, ready for the UI. */
export type RepoView = {
	readonly branch: string;
	readonly workingFiles: readonly WorkingFile[];
	readonly fileGroups: readonly FileGroup[];
	readonly sync: BranchSync;
};

/** Short oid keeps the detached badge stable and readable: `detached @ 1a2b3c4`. */
const branchLabel = (branch: RepoStatus['branch']): string =>
	branch.kind === 'detached'
		? `detached @ ${branch.oid.slice(0, 7)}`
		: branch.name;

const codeStatus = (code: StatusCode): WorkingFileStatus => {
	switch (code) {
		case 'A': {
			return 'added';
		}

		case 'D': {
			return 'deleted';
		}

		case 'R':
		case 'C': {
			return 'renamed';
		}

		case 'T': {
			return 'typechange';
		}

		default: {
			return 'modified';
		}
	}
};

/**
 * Why the index side wins: a row shows one status letter, and the staged change
 * is what a commit would record, so `A` (a freshly added file) must not be
 * masked by the worktree's `M`. The worktree change stays visible through
 * `hasUnstaged`.
 */
const statusOf = (entry: StatusEntry): WorkingFileStatus => {
	if (entry.kind === 'untracked') {
		return 'untracked';
	}

	if (entry.kind === 'unmerged') {
		return 'conflicted';
	}

	if (entry.kind === 'renamed') {
		return 'renamed';
	}

	return codeStatus(entry.index === '.' ? entry.worktree : entry.index);
};

const isStaged = (entry: StatusEntry): boolean =>
	entry.kind === 'changed' || entry.kind === 'renamed'
		? entry.index !== '.'
		: false;

const hasUnstagedChanges = (entry: StatusEntry): boolean => {
	switch (entry.kind) {
		// Nothing of an untracked or conflicted path is recorded in the index.
		case 'untracked':
		case 'unmerged': {
			return true;
		}

		default: {
			return entry.worktree !== '.';
		}
	}
};

const toWorkingFile = (entry: StatusEntry): WorkingFile => ({
	path: entry.path,
	...(entry.kind === 'renamed' && entry.from.length > 0
		? { from: entry.from }
		: {}),
	status: statusOf(entry),
	staged: isStaged(entry),
	hasUnstaged: hasUnstagedChanges(entry),
	// Additions/deletions come from numstat in `useRepo`; rows still render
	// before that read completes.
	additions: 0,
	deletions: 0,
	binary: false,
	diff: [],
});

/**
 * Why one group per path: a path with both staged and unstaged changes lands in
 * Staged only. The FILES tab acts on whole files (v1 granularity), so listing it
 * twice would offer the same file under two headers; the partial state stays
 * visible in the working-tree panel through `hasUnstaged`.
 *
 * Conflicted rows stay in Modified here: the FILES tab keeps its existing
 * categories, while the commit panel gives conflicts their own group.
 */
const groupOf = (entry: StatusEntry): FileCategory => {
	if (entry.kind === 'untracked') {
		return 'untracked';
	}

	if (entry.kind === 'unmerged') {
		return 'modified';
	}

	return entry.index === '.' ? 'modified' : 'staged';
};

const groupOrder: readonly FileCategory[] = ['modified', 'untracked', 'staged'];

const groupLabels: Readonly<Record<FileCategory, string>> = {
	modified: 'Modified',
	untracked: 'Untracked',
	staged: 'Staged',
};

/** Empty groups are dropped so the FILES tab never shows a `(0)` header. */
const toFileGroups = (entries: readonly StatusEntry[]): FileGroup[] =>
	groupOrder
		.map(category => ({
			category,
			label: groupLabels[category],
			files: entries
				.filter(entry => groupOf(entry) === category)
				.map(entry => entry.path),
		}))
		.filter(group => group.files.length > 0);

/** Expected ahead/behind counts, then the state those counts imply. */
export const syncOf = (status: RepoStatus): BranchSync => {
	const counts = {
		upstream: status.upstream,
		ahead: status.ahead,
		behind: status.behind,
	};

	// Unmerged paths mean a conflicted working tree even while the branch and
	// its upstream still look comparable; the badge must say "conflict".
	if (status.entries.some(entry => entry.kind === 'unmerged')) {
		return { ...counts, state: 'conflict' };
	}

	/*
	 * A detached HEAD has no branch to compare with an upstream. Reporting
	 * `no-upstream` implies a branch that could be pushed with `-u`; the
	 * honest state is `unknown`, which still paints the badge blue.
	 */
	if (status.branch.kind === 'detached') {
		return { ...counts, state: 'unknown' };
	}

	if (status.upstream === undefined) {
		return { ...counts, state: 'no-upstream' };
	}

	if (status.ahead > 0 && status.behind > 0) {
		return { ...counts, state: 'diverged' };
	}

	if (status.behind > 0) {
		return { ...counts, state: 'behind' };
	}

	if (status.ahead > 0) {
		return { ...counts, state: 'ahead' };
	}

	return { ...counts, state: 'up-to-date' };
};

/**
 * Map the git-side status into the shapes the components already render.
 *
 * A merge in progress is a conflicted working tree even when every path has
 * been resolved and no unmerged entry remains: the merge commit is still
 * missing, and the badge must not claim the branch is clean. The ahead/behind
 * counts stay the ones git reported.
 */
export const mapStatus = (
	status: RepoStatus,
	mergeInProgress = false,
): RepoView => {
	const sync = syncOf(status);

	return {
		branch: branchLabel(status.branch),
		workingFiles: status.entries.map(entry => toWorkingFile(entry)),
		fileGroups: toFileGroups(status.entries),
		sync:
			mergeInProgress && sync.state !== 'conflict'
				? { ...sync, state: 'conflict' }
				: sync,
	};
};
