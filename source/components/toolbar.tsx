import React from 'react';
import { Box, Text } from 'ink';
import { Badge } from '@inkjs/ui';
import { theme, asciiBorder } from '../theme.js';
import { toolbarCommands, type CommandId } from '../commands.js';
import { textWidth, truncate } from '../layout.js';
import type { OperationLogEntry, OperationState } from '../hooks/use-repo.js';
import StatusLine from './status-line.js';
import ToolbarButton from './toolbar-button.js';

type Props = {
	readonly branch: string;
	readonly width: number;
	readonly activeCommand: CommandId | undefined;
	readonly operation: OperationState;
	readonly entry: OperationLogEntry | undefined;
	readonly hasDetailsHint: boolean;
	readonly onCommand: (id: CommandId) => void;
	readonly onOpenMenu: () => void;
};

/**
 * Share of the row the branch badge may take before it truncates.
 *
 * The badge has priority to a readable width, but a long branch name must not
 * squeeze the status and the toolbar buttons: the badge is capped here, the
 * status takes the remainder and truncates, and the buttons never shrink.
 */
const badgeWidthShare = 0.35;

/** Below this the badge would be all truncation glyph, not a branch name. */
const minBadgeWidth = 6;

export default function Toolbar({
	branch,
	width,
	activeCommand,
	operation,
	entry,
	hasDetailsHint,
	onCommand,
	onOpenMenu,
}: Props) {
	const contentWidth = Math.max(0, width - 2);
	// The badge renders ` label `, so its natural width is the name plus two.
	const badgeMaxWidth = Math.min(
		contentWidth,
		Math.max(minBadgeWidth, Math.floor(contentWidth * badgeWidthShare)),
	);
	/*
	 * The name is cut before it reaches the badge: `Badge` wraps its children
	 * in a `Text` with the default wrap, so a nested `truncate-end` is ignored
	 * and a long branch would wrap the toolbar onto extra rows. Truncating the
	 * string keeps exactly one row with the badge's own background.
	 */
	const shownBranch = truncate(branch, Math.max(0, badgeMaxWidth - 2));
	const badgeWidth = Math.min(contentWidth, textWidth(shownBranch) + 2);

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
				<Box width={badgeWidth} flexShrink={0}>
					{/*
					 * Branch status badge.
					 *
					 * TODO: drive the badge color from the branch's sync state once
					 * that data is available. Intended mapping:
					 *   green  - branch is up to date with its upstream
					 *   red    - merge conflict
					 *   yellow - pull needed (behind upstream)
					 *   blue   - unknown / not yet determined
					 *
					 * Badge uppercases plain string children, but branch names are
					 * case-sensitive, so the name is wrapped to keep its exact casing.
					 */}
					<Badge color={theme.accent}>
						<Text>{shownBranch}</Text>
					</Badge>
				</Box>
				<Box flexGrow={1} flexShrink={1} marginLeft={1}>
					<StatusLine
						operation={operation}
						entry={entry}
						hasDetailsHint={hasDetailsHint}
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
