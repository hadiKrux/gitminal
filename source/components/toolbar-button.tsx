import React, { useRef, useState } from 'react';
import { Box, Text, type DOMElement } from 'ink';
import { useMouseClick, useMouseHover } from '../hooks/use-mouse.js';
import { theme } from '../theme.js';

export type ButtonTone = 'default' | 'danger';

type Props = {
	readonly label: string;
	readonly isActive?: boolean;
	readonly isDisabled?: boolean;
	readonly tone?: ButtonTone;
	readonly onPress: () => void;
};

/** Pick the button background for its current interaction state. */
const backgroundFor = (
	isActive: boolean,
	isHovered: boolean,
	isDisabled: boolean,
): string => {
	if (isDisabled) {
		return theme.bgPanel;
	}

	if (isActive) {
		return theme.accent;
	}

	if (isHovered) {
		return theme.accentBg;
	}

	return theme.bgPanel;
};

const colorFor = (
	isActive: boolean,
	isDisabled: boolean,
	tone: ButtonTone,
): string => {
	if (isActive) {
		return theme.bg;
	}

	if (isDisabled) {
		return theme.dimmer;
	}

	return tone === 'danger' ? theme.del : theme.text;
};

/**
 * An inline button for the toolbar and the commit panel.
 *
 * It works from both input paths: mouse clicks here and a matching keybinding
 * where one exists. Disabled buttons keep their footprint but ignore clicks.
 */
export default function ToolbarButton({
	label,
	isActive = false,
	isDisabled = false,
	tone = 'default',
	onPress,
}: Props) {
	const ref = useRef<DOMElement>(null);
	const [isHovered, setIsHovered] = useState(false);

	useMouseHover(ref, hovered => {
		setIsHovered(!isDisabled && hovered);
	});

	useMouseClick(ref, () => {
		if (!isDisabled) {
			onPress();
		}
	});

	return (
		<Box ref={ref}>
			<Text
				bold
				backgroundColor={backgroundFor(isActive, isHovered, isDisabled)}
				color={colorFor(isActive, isDisabled, tone)}
			>
				{` ${label} `}
			</Text>
		</Box>
	);
}
