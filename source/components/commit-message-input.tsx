import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { stripMouseReports } from '../mouse-reports.js';

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
 * breaking after the last space that fits when possible.
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

	const lines: WrappedLine[] = [];
	let start = 0;

	while (start < segment.length) {
		const limit = Math.min(start + width, segment.length);
		let end = limit;

		if (limit < segment.length) {
			const space = segment.lastIndexOf(' ', limit - 1);
			if (space > start) {
				end = space + 1;
			}
		}

		const isLastPiece = end >= segment.length;
		lines.push({
			text: segment.slice(start, end),
			start: offset + start,
			endsAtNewline: isLastPiece && endsAtNewline,
		});
		start = end;
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
		if (target === undefined) {
			return;
		}

		setCursorOffset(target.start + Math.min(cursorColumn, target.text.length));
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
				setCursorOffset(Math.max(0, cursor - 1));
				return;
			}

			if (key.rightArrow) {
				setCursorOffset(Math.min(value.length, cursor + 1));
				return;
			}

			if (key.backspace || key.delete) {
				if (cursor === 0) {
					return;
				}

				onChange(value.slice(0, cursor - 1) + value.slice(cursor));
				setCursorOffset(cursor - 1);
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
		return (
			<Box flexDirection="column" width={width} height={height}>
				<Text wrap="truncate-end">
					{isDisabled ? (
						<Text dimColor>{placeholder}</Text>
					) : (
						<>
							<Text inverse>{placeholder.slice(0, 1)}</Text>
							<Text dimColor>{placeholder.slice(1)}</Text>
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

/** Render one line, inverting the character under the cursor when focused. */
const renderLine = (
	line: WrappedLine,
	isCursorRow: boolean,
	cursorColumn: number,
	isDisabled: boolean,
): React.ReactNode => {
	if (isDisabled || !isCursorRow) {
		return line.text;
	}

	const at = line.text[cursorColumn] ?? ' ';

	return (
		<>
			{line.text.slice(0, cursorColumn)}
			<Text inverse>{at}</Text>
			{line.text.slice(cursorColumn + 1)}
		</>
	);
};
