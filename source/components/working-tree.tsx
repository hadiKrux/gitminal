import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, type DOMElement } from 'ink';
import { useMouseClick, useMouseHover } from '../hooks/use-mouse.js';
import { theme } from '../theme.js';
import { icons } from '../icons.js';
import { textWidth, truncate } from '../layout.js';
import {
	categoryOf,
	type WorkingFile,
	type WorkingGroup,
	type WorkingGroupCategory,
	type WorkingTree as WorkingTreeState,
} from '../data/types.js';
import ScrollableArea from './scrollable-area.js';
import ToolbarButton from './toolbar-button.js';
import WorkingFileRow from './working-file-row.js';

type Props = {
	readonly tree: WorkingTreeState;
	readonly width: number;
	readonly height: number;
	/** When false, e.g. while an overlay owns input, scrolling is disabled. */
	readonly isActive: boolean;
	/**
	 * Whether the arrow keys scroll this list. A list whose arrows move a
	 * commit selection passes false so only its own handler reacts; the wheel
	 * still scrolls the list under the pointer.
	 */
	// eslint-disable-next-line react/boolean-prop-naming
	readonly scrollOnArrows?: boolean;
};

type HeaderProps = {
	readonly label: string;
	readonly count: number;
	readonly width: number;
	readonly isCollapsed: boolean;
	readonly hasUnstaged: boolean;
	/** True when the group has staged paths and all of them are plain. */
	readonly hasUnstageable: boolean;
	/** False for conflicts, which can be staged but never discarded. */
	readonly isDiscardAllowed: boolean;
	readonly onToggle: () => void;
	readonly onDiscardAll: () => void;
	readonly onStageAll: () => void;
	readonly onUnstageAll: () => void;
};

const groupActionsWidth = ' Discard All '.length + 1 + ' Stage All '.length;
const stageAllWidth = ' Stage All '.length;
const unstageAllWidth = ' Unstage All '.length;

/**
 * A collapsible group header.
 *
 * While the group still has unstaged files it offers the bulk stage/discard
 * actions; once everything in it is staged, discard no longer applies and the
 * pair gives way to a single unstage action that puts the files back. A group
 * with any merge-origin file staged gets no bulk unstage: the action would
 * leave those rows staged, and recreating their conflicts is a row-level
 * action with its own warning. Conflicts keep Stage All but never Discard All:
 * `git add` resolves them, while a discard would destroy the only copy of the
 * conflicted worktree file.
 */
function GroupHeader({
	label,
	count,
	width,
	isCollapsed,
	hasUnstaged,
	hasUnstageable,
	isDiscardAllowed,
	onToggle,
	onDiscardAll,
	onStageAll,
	onUnstageAll,
}: HeaderProps) {
	const ref = useRef<DOMElement>(null);
	const [isHovered, setIsHovered] = useState(false);

	useMouseHover(ref, setIsHovered);
	useMouseClick(ref, onToggle);

	const actionsWidth = hasUnstaged
		? isDiscardAllowed
			? groupActionsWidth
			: stageAllWidth
		: hasUnstageable
		? unstageAllWidth
		: 0;
	const labelWidth = Math.max(0, width - actionsWidth);
	const disclosure = isCollapsed
		? icons.sectionCollapsed
		: icons.sectionExpanded;
	const suffix = ` (${count})`;
	const shownLabel = truncate(
		label,
		Math.max(0, labelWidth - disclosure.length - suffix.length),
	);
	const contentWidth =
		disclosure.length + textWidth(shownLabel) + suffix.length;
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
						{shownLabel}
					</Text>
					<Text color={theme.dimmer}>{suffix}</Text>
					{fill > 0 ? <Text>{' '.repeat(fill)}</Text> : null}
				</Text>
			</Box>
			<Box flexDirection="row" flexShrink={0} gap={1}>
				{hasUnstaged ? (
					<>
						{isDiscardAllowed ? (
							<ToolbarButton
								label="Discard All"
								tone="danger"
								onPress={onDiscardAll}
							/>
						) : null}
						<ToolbarButton label="Stage All" onPress={onStageAll} />
					</>
				) : hasUnstageable ? (
					<ToolbarButton label="Unstage All" onPress={onUnstageAll} />
				) : null}
			</Box>
		</Box>
	);
}

/** Split the files into the groups the panel displays. */
const toGroups = (tree: WorkingTreeState): WorkingGroup[] => {
	const groups: WorkingGroup[] = [
		{
			category: 'working',
			label: 'Working Directory',
			files: tree.files.filter(file => categoryOf(file) === 'working'),
		},
		{
			category: 'conflicted',
			label: 'Merge Conflicts',
			files: tree.files.filter(file => categoryOf(file) === 'conflicted'),
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
 * The working tree: modified files in "Working Directory", unresolved merges in
 * "Merge Conflicts", and new files in "Untracked Files". Group headers and
 * individual file rows both collapse, and an expanded row renders the file's
 * diff underneath it.
 */
export default function WorkingTree({
	tree,
	width,
	height,
	isActive,
	scrollOnArrows = true,
}: Props) {
	const [collapsedGroups, setCollapsedGroups] = useState<
		ReadonlySet<WorkingGroupCategory>
	>(() => new Set());
	// Mounted after the snapshot loads, so the first real row starts expanded.
	const [expandedFiles, setExpandedFiles] = useState<ReadonlySet<string>>(
		() => new Set(tree.files[0] === undefined ? [] : [tree.files[0].path]),
	);
	// Destructured so the effects can depend on the values they read; the
	// rule cannot track `tree.ensureDiff` back to a stable member reference.
	const { ensureDiff, files } = tree;

	// Files can vanish (discarded, staged away): drop their paths from the
	// expansion set so it does not grow all session and so a path that comes
	// back starts collapsed. The same set object is returned when nothing was
	// pruned, which lets React skip the extra render.
	useEffect(() => {
		setExpandedFiles(current => {
			if (current.size === 0) {
				return current;
			}

			const present = new Set(files.map(file => file.path));
			const next = new Set([...current].filter(path => present.has(path)));

			return next.size === current.size ? current : next;
		});
	}, [files]);

	/**
	 * Keep every expanded row's diff loaded.
	 *
	 * Expansion is the trigger, but a refresh can invalidate a diff while its
	 * path stays expanded, so this runs whenever the file snapshot changes too.
	 * `ensureDiff` is a no-op for a cache hit or an in-flight read, which also
	 * makes the effect safe to re-run after it updates the rows.
	 */
	useEffect(() => {
		for (const path of expandedFiles) {
			ensureDiff(path);
		}
	}, [expandedFiles, ensureDiff, files]);

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
		const isExpanding = !expandedFiles.has(path);
		setExpandedFiles(current => {
			const next = new Set(current);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}

			return next;
		});

		// Load immediately on expansion; the effect above covers the refresh
		// case and this call is a no-op once the cache holds the diff.
		if (isExpanding) {
			ensureDiff(path);
		}
	};

	/** Collapse a group's files, e.g. once they have all been staged. */
	const collapseFiles = (files: readonly WorkingFile[]): void => {
		setExpandedFiles(current => {
			const next = new Set(current);
			for (const file of files) {
				next.delete(file.path);
			}

			return next;
		});
	};

	const groups = toGroups(tree);

	if (groups.length === 0) {
		return (
			<Box width={width} height={height} paddingLeft={2}>
				<Text color={theme.dimmer}>Working tree clean</Text>
			</Box>
		);
	}

	return (
		<ScrollableArea
			width={width}
			height={height}
			isActive={isActive}
			scrollOnArrows={scrollOnArrows}
		>
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
								hasUnstageable={tree.hasUnstageable(group.category)}
								isDiscardAllowed={group.category !== 'conflicted'}
								onToggle={() => {
									toggleGroup(group.category);
								}}
								onDiscardAll={() => {
									tree.discardAll(group.category);
								}}
								onStageAll={() => {
									tree.stageAll(group.category);
									collapseFiles(group.files);
								}}
								onUnstageAll={() => {
									tree.unstageAll(group.category);
								}}
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
											isMergeOrigin={tree.isMergeOrigin(file.path)}
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
