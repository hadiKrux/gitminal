import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { stripMouseReports } from '../mouse-reports.js';
import { nextBoundary, previousBoundary, segmenter } from '../text-segments.js';
import { textWidth, truncate } from '../layout.js';

type Props = {
	/** Current text, owned by the caller so it can be cleared on commit. */
	readonly value: string;
	/** Visible width of the text area, used to wrap the message. */
	readonly width: number;
	/** Visible height in rows; longer messages scroll to keep the cursor. */
	readonly height: number;
	readonly placeholder: string;
	/** When true the input ignores keys and renders without a cursor. */
	readonly isDisabled: boolean;
	readonly onChange: (value: string) => void;
};

/** A visual line and the index in the message where it starts. */
type WrappedLine = {
	readonly text: string;
	readonly start: number;
	/** True when the message has a newline after this line rather than a wrap. */
	readonly endsAtNewline: boolean;
};

/**
 * Wrap one logical line (the text between newlines) into visual lines,
 * breaking after the last space that fits when possible. Widths are measured
 * in terminal cells, and breaks only fall on grapheme boundaries.
 */
const wrapSegment = (
	segment: string,
	offset: number,
	width: number,
	endsAtNewline: boolean,
): readonly WrappedLine[] => {
	if (segment.length === 0) {
		return [{ text: '', start: offset, endsAtNewline }];
	}

	const safeWidth = Math.max(1, width);
	const graphemes = [...segmenter.segment(segment)];
	const lines: WrappedLine[] = [];
	let index = 0;

	while (index < graphemes.length) {
		let cellWidth = 0;
		let lastSpace = -1;
		let end = index;

		while (end < graphemes.length) {
			const grapheme = graphemes[end]?.segment ?? '';
			const graphemeWidth = textWidth(grapheme);

			// A single grapheme wider than the view still takes a row on its
			// own rather than stalling the wrap.
			if (cellWidth === 0 && graphemeWidth > safeWidth) {
				end += 1;
				break;
			}

			if (cellWidth + graphemeWidth > safeWidth) {
				break;
			}

			cellWidth += graphemeWidth;
			if (grapheme === ' ') {
				lastSpace = end;
			}

			end += 1;
		}

		if (end === index) {
			end = index + 1;
		} else if (end < graphemes.length && lastSpace > index) {
			// Keep words whole when a space fits: break after it.
			end = lastSpace + 1;
		}

		const startIndex = graphemes[index]?.index ?? segment.length;
		const endIndex =
			end < graphemes.length
				? graphemes[end]?.index ?? segment.length
				: segment.length;
		const isLastPiece = end >= graphemes.length;
		lines.push({
			text: segment.slice(startIndex, endIndex),
			start: offset + startIndex,
			endsAtNewline: isLastPiece && endsAtNewline,
		});
		index = end;
	}

	return lines;
};

/**
 * Split the message into visual lines of at most `width` columns.
 *
 * Explicit newlines start a new line; long lines wrap after the last space
 * that fits, so words stay whole while every line still fits. Every character
 * is kept, which lets a cursor index map back to a row and column.
 */
const wrapText = (text: string, width: number): readonly WrappedLine[] => {
	const lines: WrappedLine[] = [];
	const segments = text.split('\n');
	let offset = 0;

	for (const [index, segment] of segments.entries()) {
		const isLastSegment = index === segments.length - 1;
		lines.push(...wrapSegment(segment, offset, width, !isLastSegment));
		offset += segment.length + 1;
	}

	return lines;
};

/**
 * Number of visual rows `value` occupies at `width`.
 *
 * Empty input still needs its one placeholder row, so the count never drops
 * below one; the commit box clamps the result to its own floor and cap.
 */
export const countVisualRows = (value: string, width: number): number =>
	Math.max(1, wrapText(value, Math.max(1, width)).length);

/** Visual row that contains `cursor`. */
const rowOf = (lines: readonly WrappedLine[], cursor: number): number => {
	for (const [index, line] of lines.entries()) {
		const end = line.start + line.text.length;
		if (cursor < end) {
			return index;
		}

		if (cursor === end && (line.endsAtNewline || index === lines.length - 1)) {
			return index;
		}
	}

	return lines.length - 1;
};

/** Terminal cells from the start of `lineText` to `charOffset`. */
const visualColumnOf = (lineText: string, charOffset: number): number =>
	textWidth(
		lineText.slice(0, Math.max(0, Math.min(charOffset, lineText.length))),
	);

/** UTF-16 length of the longest prefix of `lineText` fitting `column` cells. */
const offsetForVisualColumn = (lineText: string, column: number): number => {
	let used = 0;
	let length = 0;
	for (const { segment } of segmenter.segment(lineText)) {
		const segmentWidth = textWidth(segment);
		if (used + segmentWidth > column) {
			break;
		}

		used += segmentWidth;
		length += segment.length;
	}

	return length;
};

/**
 * A multi-line text area for the commit message.
 *
 * Enter inserts a newline, arrow keys move the cursor, and the view scrolls to
 * keep the cursor visible. Committing is bound to a separate shortcut so a
 * multi-line message can be written freely.
 *
 * This replaces the generic Ink text input because the mouse layer makes the
 * terminal emit mouse reports as stdin, which Ink hands to every input handler
 * as plain text. Without filtering, moving or scrolling the mouse types the
 * reports into the message.
 */
export default function CommitMessageInput({
	value,
	width,
	height,
	placeholder,
	isDisabled,
	onChange,
}: Props) {
	const [cursorOffset, setCursorOffset] = useState(value.length);
	const cursor = Math.min(cursorOffset, value.length);

	const lines = wrapText(value, Math.max(1, width));
	const cursorRow = rowOf(lines, cursor);
	const cursorLine = lines[cursorRow];
	const cursorColumn = cursorLine === undefined ? 0 : cursor - cursorLine.start;

	// Keep the cursor inside the visible rows without jumping when it moves
	// within the current view.
	const [offset, setOffset] = useState(0);
	useEffect(() => {
		setOffset(previous => {
			if (cursorRow < previous) {
				return cursorRow;
			}

			if (cursorRow >= previous + height) {
				return cursorRow - height + 1;
			}

			return previous;
		});
	}, [cursorRow, height]);
	const viewOffset = Math.min(offset, Math.max(0, lines.length - height));

	const insert = (text: string): void => {
		onChange(value.slice(0, cursor) + text + value.slice(cursor));
		setCursorOffset(cursor + text.length);
	};

	const moveToRow = (row: number): void => {
		const target = lines[row];
		const current = lines[cursorRow];
		if (target === undefined || current === undefined) {
			return;
		}

		const visualColumn = visualColumnOf(current.text, cursor - current.start);
		setCursorOffset(
			target.start + offsetForVisualColumn(target.text, visualColumn),
		);
	};

	useInput(
		(input, key) => {
			if (key.tab || key.ctrl || key.meta || key.escape) {
				return;
			}

			if (key.return) {
				insert('\n');
				return;
			}

			if (key.upArrow) {
				moveToRow(cursorRow - 1);
				return;
			}

			if (key.downArrow) {
				moveToRow(cursorRow + 1);
				return;
			}

			if (key.leftArrow) {
				setCursorOffset(previousBoundary(value, cursor));
				return;
			}

			if (key.rightArrow) {
				setCursorOffset(nextBoundary(value, cursor));
				return;
			}

			if (key.backspace) {
				if (cursor === 0) {
					return;
				}

				const previous = previousBoundary(value, cursor);
				onChange(value.slice(0, previous) + value.slice(cursor));
				setCursorOffset(previous);
				return;
			}

			if (key.delete) {
				const next = nextBoundary(value, cursor);
				if (next === cursor) {
					return;
				}

				onChange(value.slice(0, cursor) + value.slice(next));
				return;
			}

			const text = stripMouseReports(input);
			if (text.length === 0) {
				return;
			}

			insert(text);
		},
		{ isActive: !isDisabled },
	);

	const rows = Array.from({ length: height }, (_, index) => index + viewOffset);

	if (value.length === 0) {
		const shown = truncate(placeholder, Math.max(1, width));
		const first = [...segmenter.segment(shown)][0]?.segment ?? '';
		const rest = first.length === 0 ? '' : shown.slice(first.length);
		return (
			<Box flexDirection="column" width={width} height={height}>
				<Text wrap="truncate-end">
					{isDisabled ? (
						<Text dimColor>{shown}</Text>
					) : (
						<>
							<Text inverse>{first}</Text>
							<Text dimColor>{rest}</Text>
						</>
					)}
				</Text>
				{rows.slice(1).map(index => (
					<Text key={index}> </Text>
				))}
			</Box>
		);
	}

	return (
		<Box flexDirection="column" width={width} height={height}>
			{rows.map(index => {
				const line = lines[index];

				return (
					<Text key={index} wrap="truncate-end">
						{line === undefined
							? ' '
							: renderLine(line, index === cursorRow, cursorColumn, isDisabled)}
					</Text>
				);
			})}
		</Box>
	);
}

/** Render one line, inverting the grapheme under the cursor when focused. */
const renderLine = (
	line: WrappedLine,
	isCursorRow: boolean,
	cursorColumn: number,
	isDisabled: boolean,
): React.ReactNode => {
	if (isDisabled || !isCursorRow) {
		return line.text;
	}

	const safeOffset = Math.max(0, Math.min(cursorColumn, line.text.length));
	const before = line.text.slice(0, safeOffset);
	const rest = line.text.slice(safeOffset);
	const grapheme = [...segmenter.segment(rest)][0]?.segment ?? ' ';
	const after =
		rest.length === 0
			? ''
			: rest.slice(grapheme.length === 0 ? 1 : grapheme.length);

	return (
		<>
			{before}
			<Text inverse>{grapheme}</Text>
			{after}
		</>
	);
};
