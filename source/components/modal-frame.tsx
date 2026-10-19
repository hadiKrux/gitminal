import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';
import { textWidth } from '../layout.js';

/**
 * Modal paint primitives shared by every overlay.
 *
 * The layout nests as titled frame > padding > content, with modal background
 * padding on the sides. Every cell is painted with the panel background,
 * including the frame borders, so the modal reads as one solid panel rather
 * than a panel with a transparent seam around the frame.
 */

/**
 * Outer width of the modal, including its background padding and the frame.
 * Fixed for now; clamping the frame to narrow terminals is ticket 12 hardening.
 */
export const modalWidth = 46;
/**
 * Space between the modal background edge and the titled frame on the sides.
 * The frame sits flush with the modal's top and bottom edges.
 */
export const modalPadding = 1;
/** Space between the titled frame and the content. */
export const contentPaddingX = 2;
/** Width of the titled frame, inside the modal padding. */
export const frameWidth = modalWidth - modalPadding * 2;
/** Width available to each content line, inside the frame and its padding. */
export const contentWidth = frameWidth - 2 - contentPaddingX * 2;

const padding = ' '.repeat(modalPadding);
const contentPadding = ' '.repeat(contentPaddingX);
const blankContent = ' '.repeat(contentWidth);

export type Segment = {
	readonly text: string;
	readonly color?: string;
	readonly isBold?: boolean;
};

type LineProps = {
	readonly segments: readonly Segment[];
};

/**
 * A full-width content line painted on the panel background, built from
 * coloured segments. The line spans the whole content width so the selection
 * highlight and rules stay aligned.
 */
export function Line({ segments }: LineProps) {
	const content = segments.reduce(
		(width, segment) => width + textWidth(segment.text),
		0,
	);
	const fill = ' '.repeat(Math.max(0, contentWidth - content));

	return (
		<Text backgroundColor={theme.bgPanel}>
			{segments.map((segment, index) => (
				<Text
					// eslint-disable-next-line react/no-array-index-key
					key={index}
					color={segment.color}
					bold={segment.isBold}
				>
					{segment.text}
				</Text>
			))}
			{fill.length > 0 ? fill : null}
		</Text>
	);
}

/** Inline separators painted as rule lines, kept quiet against the panel. */
export function Rule() {
	return (
		<Line
			segments={[{ text: '─'.repeat(contentWidth), color: theme.dimmer }]}
		/>
	);
}

type RowProps = {
	readonly children: React.ReactNode;
};

/**
 * A content row inside the frame. The side borders and every padding cell are
 * painted with the panel background, so the whole modal reads as one solid
 * panel rather than a panel with a transparent seam around the frame.
 */
export function FrameRow({ children }: RowProps) {
	return (
		<Box flexDirection="row">
			<Text backgroundColor={theme.bgPanel}>{padding}</Text>
			<Text backgroundColor={theme.bgPanel} color={theme.dimmer}>
				│
			</Text>
			<Text backgroundColor={theme.bgPanel}>{contentPadding}</Text>
			{children}
			<Text backgroundColor={theme.bgPanel}>{contentPadding}</Text>
			<Text backgroundColor={theme.bgPanel} color={theme.dimmer}>
				│
			</Text>
			<Text backgroundColor={theme.bgPanel}>{padding}</Text>
		</Box>
	);
}

/** A blank content row, used for the frame's vertical padding and spacing. */
export function BlankRow() {
	return (
		<FrameRow>
			<Text backgroundColor={theme.bgPanel}>{blankContent}</Text>
		</FrameRow>
	);
}

/** A border row: modal padding, the border line itself, modal padding. */
export function BorderRow({ children }: RowProps) {
	return (
		<Box flexDirection="row">
			<Text backgroundColor={theme.bgPanel}>{padding}</Text>
			<Text backgroundColor={theme.bgPanel} color={theme.dimmer}>
				{children}
			</Text>
			<Text backgroundColor={theme.bgPanel}>{padding}</Text>
		</Box>
	);
}

type ModalFrameProps = {
	readonly title: string;
	readonly children: React.ReactNode;
};

/**
 * The centered modal shell every overlay is painted on.
 *
 * It owns the top border with the inverted title chip, the vertical padding,
 * and the bottom border, so an overlay only describes its content rows.
 */
export default function ModalFrame({ title, children }: ModalFrameProps) {
	const dashes = '─'.repeat(Math.max(0, frameWidth - title.length - 4));

	return (
		<Box
			position="absolute"
			width="100%"
			height="100%"
			justifyContent="center"
			alignItems="center"
		>
			<Box flexDirection="column" width={modalWidth}>
				<BorderRow>
					┌
					{/*
					 * The title uses the "rectangle" title style: the text and its
					 * surrounding space are inverted into a solid tile, so the
					 * boxed title reads as a filled chip on the border rather than
					 * floating transparent over it.
					 */}
					<Text backgroundColor={theme.text} color={theme.bgPanel}>
						{` ${title} `}
					</Text>
					{`${dashes}┐`}
				</BorderRow>
				<BlankRow />
				{children}
				<BlankRow />
				<BorderRow>{`└${'─'.repeat(frameWidth - 2)}┘`}</BorderRow>
			</Box>
		</Box>
	);
}
