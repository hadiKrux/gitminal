import React, { useCallback } from 'react';
import { Box } from 'ink';
import type { Commit, FileGroup } from '../data/types.js';
import CommitList from './commit-list.js';
import FileList from './file-list.js';
import TabBar, { type TabDef } from './tab-bar.js';

/** The two top-level views of the middle column. */
export type ExplorerTab = 'commits' | 'files';

type Props = {
	readonly commits: readonly Commit[];
	readonly selectedCommit: number;
	readonly hasMoreCommits: boolean;
	readonly isLoadingMoreCommits: boolean;
	readonly fileGroups: readonly FileGroup[];
	readonly width: number;
	readonly height: number;
	readonly activeTab: ExplorerTab;
	/** When false, e.g. while an overlay owns input, interaction is disabled. */
	readonly isActive?: boolean;
	readonly onTabChange: (tab: ExplorerTab) => void;
	readonly onSelectCommit: (hash: string) => void;
	readonly onLoadMoreCommits: () => void;
};

const tabs: readonly TabDef[] = [
	{ name: 'commits', label: 'COMMITS' },
	{ name: 'files', label: 'FILES' },
];

const isExplorerTab = (name: string): name is ExplorerTab =>
	name === 'commits' || name === 'files';

/**
 * The middle column: a Commits / Files tab bar over the active list.
 *
 * The two tabs are the two top-level views of the working tree; the commit
 * list and the file list each own their own scrolling. The active tab is
 * controlled by the app because it also decides which panel owns the arrow
 * keys, not only which list is drawn.
 */
export default function ExplorerPanel({
	commits,
	selectedCommit,
	hasMoreCommits,
	isLoadingMoreCommits,
	fileGroups,
	width,
	height,
	activeTab,
	isActive = true,
	onTabChange,
	onSelectCommit,
	onLoadMoreCommits,
}: Props) {
	const bodyHeight = Math.max(1, height - 1);
	const handleTabChange = useCallback(
		(name: string) => {
			if (isExplorerTab(name)) {
				onTabChange(name);
			}
		},
		[onTabChange],
	);

	return (
		<Box width={width} height={height} flexDirection="column">
			<TabBar
				tabs={tabs}
				active={activeTab}
				width={width}
				isActive={isActive}
				onChange={handleTabChange}
			/>
			{activeTab === 'files' ? (
				// The working tree owns the arrows in FILES mode, so the file list
				// passes false and still scrolls with the wheel. Ticket 13's focus
				// model will generalize this.
				<FileList
					groups={fileGroups}
					width={width}
					height={bodyHeight}
					isActive={isActive}
					scrollOnArrows={false}
				/>
			) : (
				<CommitList
					commits={commits}
					selectedIndex={selectedCommit}
					width={width}
					height={bodyHeight}
					hasMore={hasMoreCommits}
					isLoadingMore={isLoadingMoreCommits}
					isActive={isActive}
					onSelectCommit={onSelectCommit}
					onLoadMore={onLoadMoreCommits}
				/>
			)}
		</Box>
	);
}
