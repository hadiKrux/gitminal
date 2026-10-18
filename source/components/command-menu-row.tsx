import React, { useRef } from 'react';
import { Box, Text, type DOMElement } from 'ink';
import { useOnMouseClick, useOnMouseHover } from '@zenobius/ink-mouse';
import { theme } from '../theme.js';
import { type CommandId } from '../commands.js';

type Props = {
	readonly id: CommandId;
	readonly label: string;
	readonly width: number;
	readonly isSelected: boolean;
	readonly onPress: () => void;
	readonly onHover: () => void;
};

/** Commands that can rewrite history; they are tinted so they read as risky. */
const dangerCommands: ReadonlySet<CommandId> = new Set(['push-force']);

/**
 * A single selectable row in the command menu.
 *
 * The row is padded to the full inner width and always carries a background
 * colour; Ink only fills Text cells, so an unpainted row would let the content
 * behind the overlay show through. Selected rows invert to the accent colour,
 * matching the toolbar buttons, and the '>' cursor sits in front of the label.
 */
export default function CommandMenuRow({
	id,
	label,
	width,
	isSelected,
	onPress,
	onHover,
}: Props) {
	const ref = useRef<DOMElement>(null);

	useOnMouseHover(ref, isHovered => {
		if (isHovered) {
			onHover();
		}
	});

	useOnMouseClick(ref, isPressed => {
		if (isPressed) {
			onPress();
		}
	});

	const isDanger = dangerCommands.has(id);
	const cursor = isSelected ? '>' : ' ';
	const paddedLabel = label.padEnd(width - 2);

	return (
		<Box ref={ref}>
			<Text
				backgroundColor={isSelected ? theme.accent : theme.bgPanel}
				color={isSelected ? theme.bg : theme.dimmer}
			>
				{`${cursor} `}
			</Text>
			<Text
				bold={isSelected}
				backgroundColor={isSelected ? theme.accent : theme.bgPanel}
				color={isSelected ? theme.bg : isDanger ? theme.del : theme.dim}
				wrap="truncate-end"
			>
				{paddedLabel}
			</Text>
		</Box>
	);
}
