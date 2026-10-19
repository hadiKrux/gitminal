import type { RepoStatus, StatusCode, StatusEntry } from '../git/status.js';
import type {
	FileCategory,
	FileGroup,
	WorkingFile,
	WorkingFileStatus,
} from './types.js';

/** The slices of `Repo` that come from real git state, ready for the UI. */
export type RepoView = {
	readonly branch: string;
	readonly workingFiles: readonly WorkingFile[];
	readonly fileGroups: readonly FileGroup[];
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
 * Conflicted rows land in Modified as the catch-all "needs attention" group
 * until milestone 10 gives conflicts their own semantics.
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

/** Map the git-side status into the shapes the components already render. */
export const mapStatus = (status: RepoStatus): RepoView => ({
	branch: branchLabel(status.branch),
	workingFiles: status.entries.map(entry => toWorkingFile(entry)),
	fileGroups: toFileGroups(status.entries),
});
