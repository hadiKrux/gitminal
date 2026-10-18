import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';

type Props = {
	/** Height of the track in terminal rows, i.e. the viewport height. */
	readonly height: number;
	/** Current scroll offset in rows. */
	readonly offset: number;
	/** Total content height in rows. */
	readonly contentHeight: number;
};

/**
 * A one-column vertical scrollbar.
 *
 * The thumb is sized from the visible fraction of the content and positioned
 * from the scroll offset. When the content fits the viewport the thumb fills
 * the track, so callers can render the scrollbar unconditionally.
 */
export default function Scrollbar({ height, offset, contentHeight }: Props) {
	if (height <= 0) {
		return null;
	}

	const scrollable = contentHeight > height;
	const thumbHeight = scrollable
		? Math.max(1, Math.round((height * height) / contentHeight))
		: height;
	const maxThumbTop = Math.max(0, height - thumbHeight);
	const maxOffset = Math.max(0, contentHeight - height);
	const thumbTop =
		maxOffset === 0 || maxThumbTop === 0
			? 0
			: Math.min(maxThumbTop, Math.round((offset / maxOffset) * maxThumbTop));

	return (
		<Box width={1} height={height} flexDirection="column">
			{Array.from({ length: height }, (_, index) => {
				const isThumb = index >= thumbTop && index < thumbTop + thumbHeight;

				return (
					<Text key={index} color={isThumb ? theme.dimmer : theme.border}>
						{isThumb ? '┃' : '│'}
					</Text>
				);
			})}
		</Box>
	);
}
