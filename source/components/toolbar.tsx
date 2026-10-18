import React from 'react';
import { Box, Text } from 'ink';
import { Badge } from '@inkjs/ui';
import { theme, asciiBorder } from '../theme.js';
import { toolbarCommands, type CommandId } from '../commands.js';
import ToolbarButton from './toolbar-button.js';

type Props = {
	readonly branch: string;
	readonly width: number;
	readonly activeCommand: CommandId | undefined;
	readonly onCommand: (id: CommandId) => void;
	readonly onOpenMenu: () => void;
};

export default function Toolbar({
	branch,
	width,
	activeCommand,
	onCommand,
	onOpenMenu,
}: Props) {
	const contentWidth = Math.max(0, width - 2);

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
				<Box flexGrow={1} flexShrink={1}>
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
					 * The nested `Text` also keeps the end-truncation for narrow terminals.
					 */}
					<Badge color={theme.accent}>
						<Text wrap="truncate-end">{branch}</Text>
					</Badge>
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
