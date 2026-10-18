import React, { useRef, useState } from 'react';
import { Box, Text, type DOMElement } from 'ink';
import { useOnMouseClick, useOnMouseHover } from '@zenobius/ink-mouse';
import { theme } from '../theme.js';

type Props = {
	readonly label: string;
	readonly isActive?: boolean;
	readonly onPress: () => void;
};

/** Pick the button background for its current interaction state. */
const backgroundFor = (isActive: boolean, isHovered: boolean): string => {
	if (isActive) {
		return theme.accent;
	}

	if (isHovered) {
		return theme.accentBg;
	}

	return theme.bgPanel;
};

/**
 * A toolbar button that works from both input paths: it is activated by a
 * mouse click here, and by the matching keybinding wired up in `app.tsx`.
 */
export default function ToolbarButton({
	label,
	isActive = false,
	onPress,
}: Props) {
	const ref = useRef<DOMElement>(null);
	const [isHovered, setIsHovered] = useState(false);

	useOnMouseHover(ref, setIsHovered);
	useOnMouseClick(ref, isPressed => {
		if (isPressed) {
			onPress();
		}
	});

	return (
		<Box ref={ref}>
			<Text
				bold
				backgroundColor={backgroundFor(isActive, isHovered)}
				color={isActive ? theme.bg : theme.text}
			>
				{` ${label} `}
			</Text>
		</Box>
	);
}
