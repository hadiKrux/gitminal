import React from 'react';
import { Box, Text } from 'ink';
import { Badge } from '@inkjs/ui';
import { theme, asciiBorder } from '../theme.js';
import { toolbarCommands, type CommandId } from '../commands.js';
import { textWidth, truncate } from '../layout.js';
import type { BranchSync } from '../data/types.js';
import type { OperationLogEntry, OperationState } from '../hooks/use-repo.js';
import StatusLine from './status-line.js';
import ToolbarButton from './toolbar-button.js';

type Props = {
	readonly branch: string;
	/** How the branch relates to its upstream; colors the badge. */
	readonly sync: BranchSync;
	readonly width: number;
	readonly activeCommand: CommandId | undefined;
	readonly operation: OperationState;
	readonly entry: OperationLogEntry | undefined;
	readonly isWatchDegraded: boolean;
	readonly hasDetailsHint: boolean;
	readonly busyHint: string | undefined;
	readonly onCommand: (id: CommandId) => void;
	readonly onOpenMenu: () => void;
};

/**
 * Share of the space left after the fixed toolbar pieces that the badge may
 * take before the status slot gets the rest.
 *
 * The badge is capped first, but only from what remains after the buttons and
 * the counts are reserved: a long branch name must never push either off the
 * row. At 80 columns this leaves the status roughly 34 cells.
 */
const badgeWidthShare = 0.35;

/** Below this the badge would be all truncation glyph, not a branch name. */
const minBadgeWidth = 6;

/** Narrowest status slot worth reserving before counts are dropped. */
const minStatusWidth = 8;

/** Inline button width: ` label ` including its own padding. */
const buttonWidth = (label: string): number => textWidth(label) + 2;

/**
 * Cells the toolbar buttons always consume: every command, the menu button,
 * one gap between each, and the margin before the group.
 *
 * Kept as a constant because the status budget must subtract it before the
 * badge or the progress bar can claim anything.
 */
const toolbarButtonsWidth =
	toolbarCommands.reduce(
		(sum, command) => sum + buttonWidth(command.label),
		0,
	) +
	buttonWidth('...') +
	toolbarCommands.length +
	1;

/**
 * Badge color per sync state.
 *
 * Up to date and ahead are healthy local states (ahead still has work to
 * push, but nothing is missing), behind and diverged need a pull, a conflict
 * is the one state that blocks work, and no-upstream/unknown are neutral
 * because there is nothing to compare yet.
 */
const badgeColor = (sync: BranchSync): string => {
	switch (sync.state) {
		case 'up-to-date':
		case 'ahead': {
			return theme.success;
		}

		case 'behind':
		case 'diverged': {
			return theme.warn;
		}

		case 'conflict': {
			return theme.del;
		}

		default: {
			return theme.accent;
		}
	}
};

/** `+2 -1`, `+2`, or `-1`; empty when the branch is level with its upstream. */
const syncCounts = (sync: BranchSync): string =>
	[
		sync.ahead > 0 ? `+${sync.ahead}` : '',
		sync.behind > 0 ? `-${sync.behind}` : '',
	]
		.filter(part => part.length > 0)
		.join(' ');

export default function Toolbar({
	branch,
	sync,
	width,
	activeCommand,
	operation,
	entry,
	isWatchDegraded,
	hasDetailsHint,
	busyHint,
	onCommand,
	onOpenMenu,
}: Props) {
	const contentWidth = Math.max(0, width - 2);
	const counts = syncCounts(sync);
	// The counts render ` +2 -1`, so their footprint includes the margin.
	const countsWidth = counts.length === 0 ? 0 : textWidth(counts) + 1;
	const statusGap = 1;
	// Buttons and the status margin are fixed; only then may counts and the
	// badge claim cells. Counts are dropped only when keeping them would leave
	// no room for a readable badge and status.
	const withoutCounts = Math.max(
		0,
		contentWidth - toolbarButtonsWidth - statusGap,
	);
	const showCounts =
		countsWidth > 0 &&
		withoutCounts - countsWidth >= minBadgeWidth + minStatusWidth;
	const usable = Math.max(0, withoutCounts - (showCounts ? countsWidth : 0));
	const badgeBudget =
		usable >= minBadgeWidth
			? Math.min(
					usable,
					Math.max(minBadgeWidth, Math.floor(usable * badgeWidthShare)),
			  )
			: 0;
	/*
	 * The name is cut before it reaches the badge: `Badge` wraps its children
	 * in a `Text` with the default wrap, so a nested `truncate-end` is ignored
	 * and a long branch would wrap the toolbar onto extra rows. Truncating the
	 * string keeps exactly one row with the badge's own background.
	 */
	const shownBranch = truncate(branch, Math.max(0, badgeBudget - 2));
	const badgeWidth = Math.min(badgeBudget, textWidth(shownBranch) + 2);
	const statusWidth = Math.max(0, usable - badgeWidth);

	return (
		<Box
			width={width}
			borderStyle={asciiBorder}
			borderTop={false}
			borderLeft={false}
			borderRight={false}
			borderColor={theme.dimmer}
			paddingX={1}
		>
			<Box flexDirection="row" width={contentWidth}>
				{badgeWidth === 0 ? null : (
					<Box width={badgeWidth} flexShrink={0}>
						{/*
						 * Badge uppercases plain string children, but branch names are
						 * case-sensitive, so the name is wrapped to keep its exact casing.
						 */}
						<Badge color={badgeColor(sync)}>
							<Text>{shownBranch}</Text>
						</Badge>
					</Box>
				)}
				{showCounts ? (
					<Box flexShrink={0} marginLeft={1}>
						<Text color={theme.text}>{counts}</Text>
					</Box>
				) : null}
				<Box width={statusWidth} flexShrink={1} marginLeft={1}>
					<StatusLine
						operation={operation}
						entry={entry}
						isWatchDegraded={isWatchDegraded}
						hasDetailsHint={hasDetailsHint}
						busyHint={busyHint}
						width={statusWidth}
					/>
				</Box>
				<Box flexDirection="row" flexShrink={0} gap={1} marginLeft={1}>
					{toolbarCommands.map(command => (
						<ToolbarButton
							key={command.id}
							label={command.label}
							isActive={activeCommand === command.id}
							onPress={() => {
								onCommand(command.id);
							}}
						/>
					))}
					<ToolbarButton label="..." onPress={onOpenMenu} />
				</Box>
			</Box>
		</Box>
	);
}
