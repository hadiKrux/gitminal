import React from 'react';
import { Box } from 'ink';
import type { WorkingTree as WorkingTreeState } from '../hooks/use-working-tree.js';
import CommitBox, { commitBoxHeight } from './commit-box.js';
import WorkingTree from './working-tree.js';

type Props = {
	/** Author line for the commit box: the repo identity or its setup hint. */
	readonly author: string;
	readonly width: number;
	readonly height: number;
	readonly message: string;
	readonly isCommitFocused: boolean;
	/** False while an overlay owns input. */
	readonly isActive: boolean;
	readonly workingTree: WorkingTreeState;
	readonly onMessageChange: (value: string) => void;
	readonly onFocusCommit: () => void;
	readonly onBlurCommit: () => void;
	readonly onOpenCommitMenu: () => void;
	readonly onCommit: () => void;
};

/** Blank rows separating the commit box from the file list below it. */
const commitGapHeight = 1;

/**
 * The commit panel: message and commit action on top, then the working tree
 * grouped into tracked changes and untracked files, each file expandable to its
 * diff.
 */
export default function RightPanel({
	author,
	width,
	height,
	message,
	isCommitFocused,
	isActive,
	workingTree,
	onMessageChange,
	onFocusCommit,
	onBlurCommit,
	onOpenCommitMenu,
	onCommit,
}: Props) {
	const listHeight = Math.max(1, height - commitBoxHeight - commitGapHeight);

	return (
		<Box width={width} height={height} flexDirection="column">
			<CommitBox
				author={author}
				width={width}
				message={message}
				stagedCount={workingTree.stagedCount}
				isFocused={isCommitFocused}
				isActive={isActive}
				onMessageChange={onMessageChange}
				onFocus={onFocusCommit}
				onBlur={onBlurCommit}
				onOpenMenu={onOpenCommitMenu}
				onCommit={onCommit}
			/>
			<Box height={commitGapHeight} />
			<WorkingTree
				tree={workingTree}
				width={width}
				height={listHeight}
				isActive={isActive && !isCommitFocused}
			/>
		</Box>
	);
}
