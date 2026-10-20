import React from 'react';
import { Box } from 'ink';
import type { WorkingTree as WorkingTreeState } from '../data/types.js';
import CommitBox, { commitBoxHeight, commitMessageRows } from './commit-box.js';
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
	/**
	 * Whether the working-tree list owns the arrow keys. The commit list owns
	 * them while the COMMITS tab is active, so both lists never scroll from
	 * one press. This gates the arrow keys only: the wheel, the overlay gate,
	 * and the console still follow `isActive`, and the commit box is
	 * unaffected.
	 */
	readonly isWorkingTreeActive?: boolean;
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
 * grouped into tracked changes, merge conflicts, and untracked files, each
 * file expandable to its diff.
 */
export default function RightPanel({
	author,
	width,
	height,
	message,
	isCommitFocused,
	isActive,
	isWorkingTreeActive = true,
	workingTree,
	onMessageChange,
	onFocusCommit,
	onBlurCommit,
	onOpenCommitMenu,
	onCommit,
}: Props) {
	const messageRows = commitMessageRows(message, width, height);
	const listHeight = Math.max(
		1,
		height - commitBoxHeight(messageRows) - commitGapHeight,
	);
	const conflictCount = workingTree.files.filter(
		file => file.status === 'conflicted',
	).length;

	return (
		<Box width={width} height={height} flexDirection="column">
			<CommitBox
				author={author}
				width={width}
				message={message}
				messageRows={messageRows}
				stagedCount={workingTree.stagedCount}
				conflictCount={conflictCount}
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
				scrollOnArrows={isWorkingTreeActive}
			/>
		</Box>
	);
}
