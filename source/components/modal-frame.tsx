import React, { createContext, useContext } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';
import { textWidth, truncate } from '../layout.js';
import { useStdoutDimensions } from '../hooks/use-stdout-dimensions.js';

/**
 * Modal paint primitives shared by every overlay.
 *
 * The layout nests as titled frame > padding > content, with modal background
 * padding on the sides. Every cell is painted with the panel background,
 * including the frame borders, so the modal reads as one solid panel rather
 * than a panel with a transparent seam around the frame.
 */

/** Width the overlays are designed for; a wider terminal stops here. */
const maxModalWidth = 46;

/**
 * Narrowest modal worth painting.
 *
 * A terminal narrower than this cannot show the design width, so the frame
 * clamps down to the screen instead of pushing its right border off the edge.
 * Content rows still render; they simply get fewer cells.
 */
const minModalWidth = 20;

/** Space between the modal's outer background and the titled frame. */
const modalPadding = 1;

/** Space between the titled frame and the content. */
const contentPaddingX = 2;

/**
 * Widths derived from the terminal for one modal render.
 *
 * Kept in a context rather than module constants because the terminal can be
 * narrow enough that the designed 46 columns do not fit. Every primitive below
 * reads the same snapshot, so the frame and its content stay aligned.
 */
type ModalMetrics = {
	readonly modalWidth: number;
	readonly frameWidth: number;
	readonly contentWidth: number;
	readonly modalPadding: number;
	readonly contentPaddingX: number;
};

/** Clamp the designed width to the terminal, keeping a usable minimum. */
const modalMetrics = (columns: number | undefined): ModalMetrics => {
	const modalWidth =
		columns === undefined
			? maxModalWidth
			: Math.max(minModalWidth, Math.min(maxModalWidth, columns - 2));
	const frameWidth = modalWidth - modalPadding * 2;

	return {
		modalWidth,
		frameWidth,
		contentWidth: frameWidth - 2 - contentPaddingX * 2,
		modalPadding,
		contentPaddingX,
	};
};

const ModalMetricsContext = createContext<ModalMetrics | undefined>(undefined);

/**
 * Metrics for a primitive that ModalFrame already painted.
 *
 * The provider is always present for `Line`, `FrameRow`, `BlankRow`, and
 * `Rule`; the fallback only keeps a stray standalone use from producing
 * zero-width text.
 */
const useModalMetrics = (): ModalMetrics =>
	useContext(ModalMetricsContext) ?? modalMetrics(undefined);

export type Segment = {
	readonly text: string;
	readonly color?: string;
	readonly isBold?: boolean;
};

type LineProps = {
	readonly segments: readonly Segment[];
};

type RowProps = {
	readonly children: React.ReactNode;
};

/**
 * Width available to a content line.
 *
 * Overlay components call this instead of importing a fixed number, because a
 * narrow terminal shrinks the modal below its designed width. They sit above
 * `ModalFrame` in the tree, so they cannot see its provider; reading the same
 * stdout dimensions keeps the arithmetic they own (wrapping, path lists) in
 * step with the primitives the frame paints.
 */
export const useContentWidth = (): number => {
	const provided = useContext(ModalMetricsContext);
	const [columns] = useStdoutDimensions();
	return (provided ?? modalMetrics(columns)).contentWidth;
};

/**
 * A full-width content line painted on the panel background, built from
 * coloured segments. The line spans the whole content width so the selection
 * highlight and rules stay aligned.
 */
export function Line({ segments }: LineProps) {
	const { contentWidth } = useModalMetrics();
	const content = segments.reduce(
		(width, segment) => width + textWidth(segment.text),
		0,
	);
	const fill = ' '.repeat(Math.max(0, contentWidth - content));

	return (
		<Text backgroundColor={theme.bgPanel} wrap="truncate-end">
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
	const { contentWidth } = useModalMetrics();

	return (
		<Line
			segments={[{ text: '─'.repeat(contentWidth), color: theme.dimmer }]}
		/>
	);
}

/**
 * A content row inside the frame. The side borders and every padding cell are
 * painted with the panel background, so the whole modal reads as one solid
 * panel rather than a panel with a transparent seam around the frame.
 */
export function FrameRow({ children }: RowProps) {
	const { modalPadding, contentPaddingX } = useModalMetrics();
	const padding = ' '.repeat(modalPadding);
	const contentPadding = ' '.repeat(contentPaddingX);

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
	const { contentWidth } = useModalMetrics();

	return (
		<FrameRow>
			<Text backgroundColor={theme.bgPanel}>{' '.repeat(contentWidth)}</Text>
		</FrameRow>
	);
}

/** A border row: modal padding, the border line itself, modal padding. */
export function BorderRow({ children }: RowProps) {
	const { modalPadding } = useModalMetrics();
	const padding = ' '.repeat(modalPadding);

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
 * and the bottom border, so an overlay only describes its content rows. The
 * frame width follows the terminal so a narrow screen keeps both borders on
 * screen; a title that no longer fits is truncated before the dashes are
 * counted, so the top border can never run past the frame.
 */
export default function ModalFrame({ title, children }: ModalFrameProps) {
	const [columns] = useStdoutDimensions();
	const metrics = modalMetrics(columns);
	const titleText = truncate(title, Math.max(1, metrics.frameWidth - 4));
	const dashes = '─'.repeat(
		Math.max(0, metrics.frameWidth - textWidth(titleText) - 4),
	);

	return (
		<ModalMetricsContext.Provider value={metrics}>
			<Box
				position="absolute"
				width="100%"
				height="100%"
				justifyContent="center"
				alignItems="center"
			>
				<Box flexDirection="column" width={metrics.modalWidth}>
					<BorderRow>
						┌
						{/*
						 * The title uses the "rectangle" title style: the text and its
						 * surrounding space are inverted into a solid tile, so the
						 * boxed title reads as a filled chip on the border rather than
						 * floating transparent over it.
						 */}
						<Text backgroundColor={theme.text} color={theme.bgPanel}>
							{` ${titleText} `}
						</Text>
						{`${dashes}┐`}
					</BorderRow>
					<BlankRow />
					{children}
					<BlankRow />
					<BorderRow>{`└${'─'.repeat(metrics.frameWidth - 2)}┘`}</BorderRow>
				</Box>
			</Box>
		</ModalMetricsContext.Provider>
	);
}
