/**
 * Ways to create a commit.
 *
 * A single list backs the commit menu, so adding an option later is one entry
 * here rather than a new bespoke UI.
 */
export type CommitOptionId = 'commit' | 'commit-no-verify';

export type CommitOption = {
	readonly id: CommitOptionId;
	readonly label: string;
	readonly isDanger?: boolean;
};

export const commitOptions: readonly CommitOption[] = [
	{ id: 'commit', label: 'commit' },
	{
		id: 'commit-no-verify',
		label: 'commit --no-verify (skip hooks)',
		isDanger: true,
	},
];

export type CommitOptionSection = {
	readonly title: string;
	readonly items: readonly CommitOption[];
};

export const commitOptionSections: readonly CommitOptionSection[] = [
	{ title: 'Commit', items: commitOptions },
];
