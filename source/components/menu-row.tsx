import React, { useRef } from 'react';
import { Box, Text, type DOMElement } from 'ink';
import { useOnMouseClick, useOnMouseHover } from '@zenobius/ink-mouse';
import { theme } from '../theme.js';

type Props = {
	readonly label: string;
	readonly width: number;
	readonly isSelected: boolean;
	readonly isDanger?: boolean;
	readonly onPress: () => void;
	readonly onHover: () => void;
};

/**
 * A single selectable row in a menu modal.
 *
 * The row is padded to the full inner width and always carries a background
 * colour; Ink only fills Text cells, so an unpainted row would let the content
 * behind the overlay show through. Selected rows invert to the accent colour,
 * matching the toolbar buttons, and the '>' cursor sits in front of the label.
 */
export default function MenuRow({
	label,
	width,
	isSelected,
	isDanger = false,
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
