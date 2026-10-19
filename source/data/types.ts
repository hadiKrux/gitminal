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
	/** Display date from `formatDate`; empty for the pending row. */
	date: string;
	/** Files changed, from the commit's numstat block; undefined for pending. */
	fileCount?: number;
	/** Lines added, summed over the numstat block; undefined for pending. */
	additions?: number;
	/** Lines removed, summed over the numstat block; undefined for pending. */
	deletions?: number;
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
	/** True when git calls the change binary and numstat reports no counts. */
	readonly binary: boolean;
	readonly diff: readonly DiffLine[];
};

/** The two groups the commit panel splits the working tree into. */
export type WorkingGroupCategory = 'working' | 'untracked';

export type WorkingGroup = {
	readonly category: WorkingGroupCategory;
	readonly label: string;
	readonly files: readonly WorkingFile[];
};

/** Untracked files get their own group; everything else is a working change. */
export const categoryOf = (file: WorkingFile): WorkingGroupCategory =>
	file.status === 'untracked' ? 'untracked' : 'working';

/**
 * The working-tree view the commit panel renders and acts through.
 *
 * The state lives in `useRepo` (it is the single owner of git state); this
 * type is the contract between the panel and the actions, so the components
 * stay presentational and never reach for git themselves.
 */
export type WorkingTree = {
	readonly files: readonly WorkingFile[];
	readonly stagedCount: number;
	/**
	 * Ask for a row's diff; a cache hit, an in-flight load, or an edge state
	 * makes it a no-op. Expanding a row is lazy, so this is the only entry
	 * point that starts diff work.
	 */
	ensureDiff: (path: string) => void;
	isStaged: (path: string) => boolean;
	hasUnstaged: (category: WorkingGroupCategory) => boolean;
	toggleStage: (path: string) => void;
	stageAll: (category: WorkingGroupCategory) => void;
	unstageAll: (category: WorkingGroupCategory) => void;
	discard: (path: string) => void;
	discardAll: (category: WorkingGroupCategory) => void;
};
