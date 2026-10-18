import React from 'react';
import { Text } from 'ink';

export type Cell = {
	text: string;
	color?: string;
	backgroundColor?: string;
	bold?: boolean;
	italic?: boolean;
	dimColor?: boolean;
};

type Props = {
	readonly width: number;
	readonly backgroundColor?: string;
	readonly left?: Cell[];
	readonly right?: Cell[];
};

const styleProps = (cell: Cell) => ({
	color: cell.color,
	backgroundColor: cell.backgroundColor,
	bold: cell.bold,
	italic: cell.italic,
	dimColor: cell.dimColor,
});

const lengthOf = (cells: Cell[]): number =>
	cells.reduce((total, cell) => total + cell.text.length, 0);

const fit = (cells: Cell[], max: number): Cell[] => {
	const out: Cell[] = [];
	let remaining = max;

	for (const cell of cells) {
		if (remaining <= 0) {
			break;
		}

		if (cell.text.length <= remaining) {
			out.push(cell);
			remaining -= cell.text.length;
		} else {
			out.push({ ...cell, text: cell.text.slice(0, remaining) });
			remaining = 0;
		}
	}

	return out;
};

export default function TextRow({
	width,
	backgroundColor,
	left = [],
	right = [],
}: Props) {
	const rightLength = lengthOf(right);
	const separator = rightLength > 0 ? 1 : 0;
	const leftCells = fit(left, Math.max(0, width - rightLength - separator));
	const filler = Math.max(0, width - lengthOf(leftCells) - rightLength);

	return (
		<Text backgroundColor={backgroundColor} wrap="truncate-end">
			{leftCells.map((cell, index) => (
				// eslint-disable-next-line react/no-array-index-key
				<Text key={`l${index}`} {...styleProps(cell)}>
					{cell.text}
				</Text>
			))}
			{filler > 0 ? <Text>{' '.repeat(filler)}</Text> : null}
			{right.map((cell, index) => (
				// eslint-disable-next-line react/no-array-index-key
				<Text key={`r${index}`} {...styleProps(cell)}>
					{cell.text}
				</Text>
			))}
		</Text>
	);
}
