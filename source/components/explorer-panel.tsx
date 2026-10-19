import React, { useState } from 'react';
import { Box } from 'ink';
import type { Commit, FileGroup } from '../data/types.js';
import CommitList from './commit-list.js';
import FileList from './file-list.js';
import TabBar, { type TabDef } from './tab-bar.js';

type Props = {
	/** Sample data until milestone 7 replaces it with the real log. */
	readonly commits: readonly Commit[];
	readonly selectedCommit: number;
	readonly fileGroups: readonly FileGroup[];
	readonly width: number;
	readonly height: number;
	/** When false, e.g. while an overlay owns input, interaction is disabled. */
	readonly isActive?: boolean;
};

const tabs: readonly TabDef[] = [
	{ name: 'commits', label: 'COMMITS' },
	{ name: 'files', label: 'FILES' },
];

/**
 * The middle column: a Commits / Files tab bar over the active list.
 *
 * The two tabs are the two top-level views of the working tree; the commit
 * list and the file list each own their own scrolling.
 */
export default function ExplorerPanel({
	commits,
	selectedCommit,
	fileGroups,
	width,
	height,
	isActive = true,
}: Props) {
	const [active, setActive] = useState('commits');
	const bodyHeight = Math.max(1, height - 1);

	return (
		<Box width={width} height={height} flexDirection="column">
			<TabBar
				tabs={tabs}
				active={active}
				width={width}
				isActive={isActive}
				onChange={setActive}
			/>
			{active === 'files' ? (
				<FileList
					groups={fileGroups}
					width={width}
					height={bodyHeight}
					isActive={isActive}
				/>
			) : (
				<CommitList
					commits={commits}
					selectedIndex={selectedCommit}
					width={width}
					height={bodyHeight}
					isActive={isActive}
				/>
			)}
		</Box>
	);
}
