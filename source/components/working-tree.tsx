import React, { useRef, useState } from 'react';
import { Box, Text, type DOMElement } from 'ink';
import { useOnMouseClick, useOnMouseHover } from '@zenobius/ink-mouse';
import { theme } from '../theme.js';
import { icons } from '../icons.js';
import { truncate } from '../layout.js';
import { commitLabel } from '../labels.js';
import type { WorkingGroup, WorkingGroupCategory } from '../data/types.js';
import {
	categoryOf,
	type WorkingTree as WorkingTreeState,
} from '../hooks/use-working-tree.js';
import ScrollableArea from './scrollable-area.js';
import ToolbarButton from './toolbar-button.js';
import WorkingFileRow from './working-file-row.js';

type Props = {
	readonly tree: WorkingTreeState;
	readonly width: number;
	readonly height: number;
	readonly isActive: boolean;
	readonly onCommit: () => void;
};

type HeaderProps = {
	readonly label: string;
	readonly count: number;
	readonly width: number;
	readonly isCollapsed: boolean;
	readonly hasUnstaged: boolean;
	readonly stagedCount: number;
	readonly onToggle: () => void;
	readonly onDiscardAll: () => void;
	readonly onStageAll: () => void;
	readonly onCommit: () => void;
};

const groupActionsWidth = ' Discard All '.length + 1 + ' Stage All '.length;

/**
 * A collapsible group header.
 *
 * While the group still has unstaged files it offers the bulk stage/discard
 * actions; once everything in it is staged those give way to the commit action,
 * since there is nothing left to stage or discard.
 */
function GroupHeader({
	label,
	count,
	width,
	isCollapsed,
	hasUnstaged,
	stagedCount,
	onToggle,
	onDiscardAll,
	onStageAll,
	onCommit,
}: HeaderProps) {
	const ref = useRef<DOMElement>(null);
	const [isHovered, setIsHovered] = useState(false);

	useOnMouseHover(ref, setIsHovered);
	useOnMouseClick(ref, pressed => {
		if (pressed) {
			onToggle();
		}
	});

	const showCommit = !hasUnstaged && stagedCount > 0;
	const actionsWidth = hasUnstaged
		? groupActionsWidth
		: showCommit
		? commitLabel(stagedCount).length + 2
		: 0;
	const labelWidth = Math.max(0, width - actionsWidth);
	const disclosure = isCollapsed
		? icons.sectionCollapsed
		: icons.sectionExpanded;
	const suffix = ` (${count})`;
	const contentWidth = disclosure.length + label.length + suffix.length;
	const fill = Math.max(0, labelWidth - contentWidth);

	return (
		<Box flexDirection="row" width={width}>
			<Box ref={ref} width={labelWidth} flexShrink={0}>
				<Text
					backgroundColor={isHovered ? theme.accentBg : undefined}
					wrap="truncate-end"
				>
					<Text color={theme.dimmer}>{disclosure}</Text>
					<Text bold color={theme.labelFg}>
						{truncate(
							label,
							Math.max(0, labelWidth - disclosure.length - suffix.length),
						)}
					</Text>
					<Text color={theme.dimmer}>{suffix}</Text>
					{fill > 0 ? <Text>{' '.repeat(fill)}</Text> : null}
				</Text>
			</Box>
			<Box flexDirection="row" flexShrink={0} gap={1}>
				{hasUnstaged ? (
					<>
						<ToolbarButton
							label="Discard All"
							tone="danger"
							onPress={onDiscardAll}
						/>
						<ToolbarButton label="Stage All" onPress={onStageAll} />
					</>
				) : null}
				{showCommit ? (
					<ToolbarButton label={commitLabel(stagedCount)} onPress={onCommit} />
				) : null}
			</Box>
		</Box>
	);
}

/** Split the remaining files into the two groups the panel displays. */
const toGroups = (tree: WorkingTreeState): WorkingGroup[] => {
	const groups: WorkingGroup[] = [
		{
			category: 'working',
			label: 'Working Directory',
			files: tree.files.filter(file => categoryOf(file) === 'working'),
		},
		{
			category: 'untracked',
			label: 'Untracked Files',
			files: tree.files.filter(file => categoryOf(file) === 'untracked'),
		},
	];

	return groups.filter(group => group.files.length > 0);
};

/**
 * The working tree: modified files in "Working Directory" and new files in
 * "Untracked Files". Group headers and individual file rows both collapse, and
 * an expanded row renders the file's diff underneath it.
 */
export default function WorkingTree({
	tree,
	width,
	height,
	isActive,
	onCommit,
}: Props) {
	const [collapsedGroups, setCollapsedGroups] = useState<
		ReadonlySet<WorkingGroupCategory>
	>(() => new Set());
	const [expandedFiles, setExpandedFiles] = useState<ReadonlySet<string>>(
		() => new Set(tree.files[0] === undefined ? [] : [tree.files[0].path]),
	);

	const toggleGroup = (category: WorkingGroupCategory): void => {
		setCollapsedGroups(current => {
			const next = new Set(current);
			if (next.has(category)) {
				next.delete(category);
			} else {
				next.add(category);
			}

			return next;
		});
	};

	const toggleFile = (path: string): void => {
		setExpandedFiles(current => {
			const next = new Set(current);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}

			return next;
		});
	};

	const groups = toGroups(tree);

	if (groups.length === 0) {
		return (
			<Box width={width} height={height} paddingX={1}>
				<Text color={theme.dimmer}>Working tree clean</Text>
			</Box>
		);
	}

	return (
		<ScrollableArea width={width} height={height} isActive={isActive}>
			{contentWidth =>
				groups.map((group, index) => {
					const isCollapsed = collapsedGroups.has(group.category);

					return (
						<Box
							key={group.category}
							flexDirection="column"
							marginTop={index === 0 ? 0 : 1}
						>
							<GroupHeader
								label={group.label}
								count={group.files.length}
								width={contentWidth}
								isCollapsed={isCollapsed}
								hasUnstaged={tree.hasUnstaged(group.category)}
								stagedCount={tree.stagedCount}
								onToggle={() => {
									toggleGroup(group.category);
								}}
								onDiscardAll={() => {
									tree.discardAll(group.category);
								}}
								onStageAll={() => {
									tree.stageAll(group.category);
								}}
								onCommit={onCommit}
							/>
							{isCollapsed
								? null
								: group.files.map(file => (
										<WorkingFileRow
											key={file.path}
											file={file}
											width={contentWidth}
											isExpanded={expandedFiles.has(file.path)}
											isStaged={tree.isStaged(file.path)}
											onToggle={() => {
												toggleFile(file.path);
											}}
											onDiscard={() => {
												tree.discard(file.path);
											}}
											onStage={() => {
												tree.toggleStage(file.path);
											}}
										/>
								  ))}
						</Box>
					);
				})
			}
		</ScrollableArea>
	);
}
