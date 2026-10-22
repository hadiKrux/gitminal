import React, { useState } from 'react';
import { theme } from '../theme.js';
import { textWidth, truncate } from '../layout.js';
import { useKeyboardShortcuts } from '../hooks/use-keyboard-shortcuts.js';
import MenuRow from './menu-row.js';
import ModalFrame, {
	BlankRow,
	FrameRow,
	Line,
	useContentWidth,
} from './modal-frame.js';

type Props = {
	/** What is being confirmed, e.g. `Discard` or `Discard All`. */
	readonly label: string;
	/** What the action does, in the user's terms. */
	readonly description: string;
	/** The destructive button's verb, e.g. `Delete` or `Discard All`. */
	readonly confirmLabel: string;
	readonly paths: readonly string[];
	/** Terminal height, so the visible path list fits the screen. */
	readonly rows: number;
	readonly onConfirm: () => void;
	readonly onCancel: () => void;
};

/** Cancel first: the default selection must be the one that changes nothing. */
const cancelIndex = 0;
const confirmIndex = 1;

/**
 * Rows the dialog spends outside description and paths.
 *
 * Four frame rows (two borders, two blank padding rows), the path count, the
 * blank row before the buttons, Cancel, and the confirm action. Path rows and
 * the optional "... and N more" row are what the height arithmetic divides up.
 */
const chromeRows = 8;

/** Path rows the dialog is willing to show at once. */
const maxShownPaths = 10;

/** One path row is always reserved when the terminal leaves room for it. */
const minPathRows = 1;

/**
 * Word-wrap one description at the modal's content width.
 *
 * The modal frame follows the terminal width, so a sentence that explains a
 * destructive action must wrap instead of running under the border. A word
 * wider than the row is truncated rather than split mid-cell.
 */
const wrapText = (text: string, width: number): readonly string[] => {
	if (width <= 0) {
		return [text];
	}

	const lines: string[] = [];
	let current = '';

	for (const word of text.split(/\s+/).filter(part => part.length > 0)) {
		const candidate = current.length === 0 ? word : `${current} ${word}`;

		if (textWidth(candidate) <= width) {
			current = candidate;
			continue;
		}

		if (current.length > 0) {
			lines.push(current);
		}

		current = truncate(word, width);
	}

	if (current.length > 0) {
		lines.push(current);
	}

	return lines;
};

/**
 * Confirmation shown before a discard that cannot be undone.
 *
 * It exists for untracked paths (no index copy to restore from) and for every
 * bulk discard. Escape and Cancel change nothing; enter on the destructive
 * action runs the requester's callback, which only the app invokes after
 * closing this overlay. The path list keeps its first rows and summarises the
 * rest, and its size follows the terminal so a long list cannot push the
 * buttons off the screen.
 */
export default function ConfirmOverlay({
	label,
	description,
	confirmLabel,
	paths,
	rows,
	onConfirm,
	onCancel,
}: Props) {
	const [selected, setSelected] = useState(cancelIndex);

	useKeyboardShortcuts({
		'move-up'() {
			setSelected(current => Math.max(cancelIndex, current - 1));
		},
		'move-down'() {
			setSelected(current => Math.min(confirmIndex, current + 1));
		},
		'activate-selection'() {
			if (selected === confirmIndex) {
				onConfirm();
			} else {
				onCancel();
			}
		},
		'close-overlay': onCancel,
	});

	const contentWidth = useContentWidth();
	/*
	 * Height arithmetic mirrors what ModalFrame actually paints. The
	 * description is wrapped at the real content width and capped so at least
	 * one path row and its possible remainder row survive; the remaining path
	 * budget then decides how many paths fit. One description line is the
	 * floor even when the terminal is short: a destructive action that is not
	 * explained is worse than a path row. The "..." row takes one of those
	 * rows when the list is longer than the budget, so a long list shortens the
	 * visible paths instead of pushing Cancel and confirm off screen.
	 */
	const descriptionBudget = Math.max(1, rows - chromeRows - minPathRows - 1);
	const descriptionLines = wrapText(description, contentWidth).slice(
		0,
		descriptionBudget,
	);
	const availablePathRows = Math.max(
		0,
		rows - chromeRows - descriptionLines.length,
	);
	const pathBudget = Math.min(maxShownPaths, availablePathRows);
	const fitsWithoutRemainder = paths.length <= pathBudget;
	const shownCount = fitsWithoutRemainder
		? paths.length
		: Math.max(0, Math.min(pathBudget, availablePathRows - 1));
	const shown = paths.slice(0, shownCount);
	const remaining = paths.length - shownCount;
	const showRemaining = remaining > 0 && shownCount + 1 <= availablePathRows;
	const pathCount = `${paths.length} path${paths.length === 1 ? '' : 's'}`;

	return (
		<ModalFrame title={label}>
			{descriptionLines.map((text, index) => (
				<FrameRow
					// eslint-disable-next-line react/no-array-index-key -- wrapped fragments are positional
					key={`description-${index}`}
				>
					<Line segments={[{ text, color: theme.warn }]} />
				</FrameRow>
			))}
			<FrameRow>
				<Line
					segments={[
						{
							text: truncate(pathCount, contentWidth),
							color: theme.dimmer,
						},
					]}
				/>
			</FrameRow>
			{shown.map((path, index) => (
				<FrameRow
					// eslint-disable-next-line react/no-array-index-key -- duplicate paths would collide, the index disambiguates
					key={`${path}-${index}`}
				>
					<Line
						segments={[
							{ text: truncate(path, contentWidth), color: theme.dim },
						]}
					/>
				</FrameRow>
			))}
			{showRemaining ? (
				<FrameRow>
					<Line
						segments={[
							{
								text: truncate(`... and ${remaining} more`, contentWidth),
								color: theme.dimmer,
							},
						]}
					/>
				</FrameRow>
			) : null}
			<BlankRow />
			<FrameRow>
				<MenuRow
					label="Cancel"
					width={contentWidth}
					isSelected={selected === cancelIndex}
					onPress={onCancel}
					onHover={() => {
						setSelected(cancelIndex);
					}}
				/>
			</FrameRow>
			<FrameRow>
				<MenuRow
					isDanger
					label={confirmLabel}
					width={contentWidth}
					isSelected={selected === confirmIndex}
					onPress={onConfirm}
					onHover={() => {
						setSelected(confirmIndex);
					}}
				/>
			</FrameRow>
		</ModalFrame>
	);
}
