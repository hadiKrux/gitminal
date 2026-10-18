import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';
import { useKeyboardShortcuts } from '../hooks/use-keyboard-shortcuts.js';
import MenuRow from './menu-row.js';

export type MenuItem<Id extends string = string> = {
	readonly id: Id;
	readonly label: string;
	readonly isDanger?: boolean;
};

export type MenuSection<Id extends string = string> = {
	readonly title: string;
	readonly items: ReadonlyArray<MenuItem<Id>>;
};

type Props<Id extends string> = {
	readonly title: string;
	readonly sections: ReadonlyArray<MenuSection<Id>>;
	readonly onSelect: (id: Id) => void;
	readonly onClose: () => void;
};

/** Outer width of the modal, including its background padding and the frame. */
const menuWidth = 46;
/**
 * Space between the modal background edge and the titled frame on the sides.
 * The frame sits flush with the modal's top and bottom edges.
 */
const modalPadding = 1;
/** Space between the titled frame and the content. */
const contentPaddingX = 2;
/** Width of the titled frame, inside the modal padding. */
const frameWidth = menuWidth - modalPadding * 2;
/** Width available to each content line, inside the frame and its padding. */
const contentWidth = frameWidth - 2 - contentPaddingX * 2;

const padding = ' '.repeat(modalPadding);
const contentPadding = ' '.repeat(contentPaddingX);
const blankContent = ' '.repeat(contentWidth);

type Segment = {
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
function Line({ segments }: LineProps) {
	const content = segments.reduce(
		(width, segment) => width + segment.text.length,
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
function Rule() {
	return (
		<Line
			segments={[{ text: '-'.repeat(contentWidth), color: theme.accentBg }]}
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
function FrameRow({ children }: RowProps) {
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
function BlankRow() {
	return (
		<FrameRow>
			<Text backgroundColor={theme.bgPanel}>{blankContent}</Text>
		</FrameRow>
	);
}

/** A border row: modal padding, the border line itself, modal padding. */
function BorderRow({ children }: RowProps) {
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

/**
 * Centered modal listing selectable commands grouped by section.
 *
 * The layout nests as titled frame > padding > content, with modal background
 * padding on the sides. Every cell is painted with the panel background,
 * including the frame borders, so the modal is one solid panel.
 *
 * Keyboard and mouse both drive the same selection: arrows (or the keybinding
 * equivalents) move it, enter runs the highlighted command, and the mouse
 * highlights on hover and runs on click.
 */
export default function MenuModal<Id extends string>({
	title,
	sections,
	onSelect,
	onClose,
}: Props<Id>) {
	const items = sections.flatMap(section => section.items);
	const [selected, setSelected] = useState(0);
	const selectedItem = items[selected];

	const move = (delta: number): void => {
		setSelected(current =>
			Math.min(items.length - 1, Math.max(0, current + delta)),
		);
	};

	useKeyboardShortcuts({
		'move-down'() {
			move(1);
		},
		'move-up'() {
			move(-1);
		},
		'activate-selection'() {
			if (selectedItem !== undefined) {
				onSelect(selectedItem.id);
			}
		},
		'close-overlay': onClose,
	});

	const dashes = '─'.repeat(Math.max(0, frameWidth - title.length - 4));

	return (
		<Box
			position="absolute"
			width="100%"
			height="100%"
			justifyContent="center"
			alignItems="center"
		>
			<Box flexDirection="column" width={menuWidth}>
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
				{sections.map(section => (
					<React.Fragment key={section.title}>
						<FrameRow>
							<Line
								segments={[
									{
										text: section.title.toUpperCase(),
										color: theme.dimmer,
										isBold: true,
									},
								]}
							/>
						</FrameRow>
						{section.items.map(item => (
							<FrameRow key={item.id}>
								<MenuRow
									label={item.label}
									width={contentWidth}
									isSelected={selectedItem?.id === item.id}
									isDanger={item.isDanger}
									onPress={() => {
										onSelect(item.id);
									}}
									onHover={() => {
										setSelected(items.indexOf(item));
									}}
								/>
							</FrameRow>
						))}
						<BlankRow />
					</React.Fragment>
				))}
				<FrameRow>
					<Rule />
				</FrameRow>
				<FrameRow>
					<Line
						segments={[
							{ text: 'enter', color: theme.accent, isBold: true },
							{ text: ' run   ', color: theme.dimmer },
							{ text: 'esc', color: theme.accent, isBold: true },
							{ text: ' close', color: theme.dimmer },
						]}
					/>
				</FrameRow>
				<BlankRow />
				<BorderRow>{`└${'─'.repeat(frameWidth - 2)}┘`}</BorderRow>
			</Box>
		</Box>
	);
}
