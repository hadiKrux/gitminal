import React, { useState } from 'react';
import { Text, useInput } from 'ink';
import { stripMouseReports } from '../mouse-reports.js';
import { nextBoundary, previousBoundary, segmenter } from '../text-segments.js';
import { theme } from '../theme.js';
import { textWidth } from '../layout.js';

type Props = {
	readonly value: string;
	/** Visible width of the field; the row is filled to this width. */
	readonly width: number;
	readonly placeholder: string;
	readonly onChange: (value: string) => void;
	readonly onSubmit: () => void;
};

/**
 * A single-line text field for overlays.
 *
 * This is deliberately not `ink-text-input`: the mouse layer makes the
 * terminal write mouse reports to stdin, and Ink hands those reports to input
 * handlers as plain text, so a field without `stripMouseReports` would insert
 * escape sequences while the pointer moves. Enter submits instead of inserting
 * a newline, which is the one difference from `CommitMessageInput` that makes
 * this a shared primitive rather than a height-1 reuse.
 */
export default function SingleLineInput({
	value,
	width,
	placeholder,
	onChange,
	onSubmit,
}: Props) {
	const [cursorOffset, setCursorOffset] = useState(value.length);
	const cursor = Math.min(cursorOffset, value.length);

	const insert = (text: string): void => {
		onChange(value.slice(0, cursor) + text + value.slice(cursor));
		setCursorOffset(cursor + text.length);
	};

	useInput((input, key) => {
		if (key.tab || key.ctrl || key.meta || key.escape) {
			return;
		}

		if (key.return) {
			onSubmit();
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
		if (text.length > 0) {
			insert(text);
		}
	});

	if (value.length === 0) {
		const first = [...segmenter.segment(placeholder)][0]?.segment ?? '';
		const rest = first.length === 0 ? '' : placeholder.slice(first.length);
		const fill = Math.max(0, width - textWidth(placeholder));

		return (
			<Text backgroundColor={theme.bgPanel} wrap="truncate-end">
				<Text inverse>{first}</Text>
				<Text dimColor>{rest}</Text>
				{fill > 0 ? ' '.repeat(fill) : null}
			</Text>
		);
	}

	const before = value.slice(0, cursor);
	const rest = value.slice(cursor);
	const grapheme = [...segmenter.segment(rest)][0]?.segment ?? ' ';
	const after =
		rest.length === 0
			? ''
			: rest.slice(grapheme.length === 0 ? 1 : grapheme.length);
	// The cursor cell only needs filling when it is the synthetic space at the
	// end; an existing grapheme already occupies its cell.
	const cursorCells = rest.length === 0 ? 1 : 0;
	const fill = Math.max(0, width - textWidth(value) - cursorCells);

	return (
		<Text backgroundColor={theme.bgPanel} wrap="truncate-end">
			{before}
			<Text inverse>{grapheme}</Text>
			{after}
			{fill > 0 ? ' '.repeat(fill) : null}
		</Text>
	);
}
