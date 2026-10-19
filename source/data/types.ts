export type TreeNode = {
	label: string;
	depth: number;
	active?: boolean;
};

export type SidebarSection = {
	title: string;
	count: number;
	collapsed: boolean;
	items: TreeNode[];
};

export type Commit = {
	hash: string;
	message: string;
	author: string;
	date: string;
	fileCount?: number;
	tags: string[];
	/** Parent hashes in history order; empty for the root (and for pending). */
	parents: string[];
	pending?: boolean;
};

export type FileCategory = 'modified' | 'untracked' | 'staged';

/** A group of working-tree files shown under the "Files" tab. */
export type FileGroup = {
	readonly category: FileCategory;
	readonly label: string;
	readonly files: readonly string[];
};

export type CommitMeta = {
	hash: string;
	tree: string;
	author: string;
	date: string;
	parent: string;
	filesChanged: number;
	additions: number;
	deletions: number;
};

export type DiffLineKind = 'context' | 'add' | 'del' | 'header';

export type DiffLine = {
	kind: DiffLineKind;
	oldNumber: number | undefined;
	newNumber: number | undefined;
	text: string;
};

/** Git status of a file in the working tree. */
export type WorkingFileStatus =
	| 'modified'
	| 'added'
	| 'deleted'
	| 'untracked'
	| 'conflicted'
	| 'renamed'
	| 'typechange';

/** A single file in the working tree, with the diff of its pending change. */
export type WorkingFile = {
	readonly path: string;
	readonly status: WorkingFileStatus;
	/** True when the index holds a change for the path (git's X side). */
	readonly staged: boolean;
	/**
	 * True when the worktree differs from the index (git's Y side); untracked
	 * and conflicted rows count as unstaged, since nothing of them is recorded.
	 */
	readonly hasUnstaged: boolean;
	readonly additions: number;
	readonly deletions: number;
	readonly diff: readonly DiffLine[];
};

/** The two groups the commit panel splits the working tree into. */
export type WorkingGroupCategory = 'working' | 'untracked';

export type WorkingGroup = {
	readonly category: WorkingGroupCategory;
	readonly label: string;
	readonly files: readonly WorkingFile[];
};

export type Repo = {
	branch: string;
	sections: SidebarSection[];
	commits: Commit[];
	selectedCommit: number;
	fileGroups: FileGroup[];
	meta: CommitMeta;
	workingFiles: WorkingFile[];
};
