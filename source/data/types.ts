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
	pending?: boolean;
};

export type ChangedFile = {
	path: string;
	additions: number;
	deletions: number;
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

export type DiffLineKind = 'context' | 'add' | 'del';

export type DiffLine = {
	kind: DiffLineKind;
	oldNumber: number | undefined;
	newNumber: number | undefined;
	text: string;
};

export type Repo = {
	branch: string;
	sections: SidebarSection[];
	commits: Commit[];
	selectedCommit: number;
	openFiles: string[];
	activeFile: number;
	meta: CommitMeta;
	changedFiles: ChangedFile[];
	selectedFile: number;
	diff: DiffLine[];
	code: string;
	language: string;
};
