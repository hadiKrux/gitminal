import React from 'react';
import { Box } from 'ink';
import { theme, colorAt, tagColors, graphColors, tint } from '../theme.js';
import type { Commit } from '../data/types.js';
import { buildGraph, type GraphRow } from '../data/graph.js';
import ScrollableArea from './scrollable-area.js';
import TextRow, { type Cell } from './text-row.js';

type Props = {
	readonly commits: readonly Commit[];
	readonly selectedIndex: number;
	readonly width: number;
	readonly height: number;
	/** When false, e.g. while an overlay owns input, scrolling is disabled. */
	readonly isActive?: boolean;
};

/** Rows scrolled per arrow press (a tagless commit row is 2 rows tall). */
const commitStep = 2;

type RowProps = {
	readonly commit: Commit;
	readonly isSelected: boolean;
	readonly width: number;
	readonly graph: GraphRow;
	/** Columns the gutter is padded to, so every message starts at the same x. */
	readonly laneCount: number;
	/** One palette color per lane; off for a linear history, which is one line. */
	readonly isColored: boolean;
};

/**
 * Graph gutter cells for a row of lane characters, one cell per lane so each
 * branch keeps its own color. A linear history stays a single muted tone;
 * colors only earn their keep once two or more branches share the list.
 */
const gutter = (
	chars: readonly string[],
	nodeChar: string,
	laneCount: number,
	isColored: boolean,
): Cell[] =>
	Array.from({ length: laneCount }, (_unused, lane) => {
		const char = chars[lane] ?? ' ';
		return {
			text: `${char === '*' ? nodeChar : char} `,
			color: isColored ? colorAt(graphColors, lane) : theme.dimmer,
		};
	});

/**
 * Padded text drawn on a softened version of its color. A full-strength fill
 * glares in a dense list, so the background is the color tinted into the base
 * background while the text keeps the color's identity.
 */
const chip = (text: string, color: string): Cell => ({
	text: ` ${text} `,
	color,
	backgroundColor: tint(color, theme.bg, 0.22),
});

function CommitRow({
	commit,
	isSelected,
	width,
	graph,
	laneCount,
	isColored,
}: RowProps) {
	const background = isSelected ? theme.accentBg : undefined;
	const lane = (chars: readonly string[], nodeChar: string): Cell[] =>
		gutter(chars, nodeChar, laneCount, isColored);

	const countCells: Cell[] =
		commit.fileCount === undefined
			? []
			: [chip(String(commit.fileCount), theme.fileCount)];

	// Tags and branches ride above the message as chips, one per row, so a
	// commit's message and file count keep the full row width.
	const tagRows: Cell[] = commit.tags.map((tag, tagIndex) =>
		chip(tag, colorAt(tagColors, tagIndex)),
	);

	return (
		<Box flexDirection="column">
			{tagRows.map((cell, tagIndex) => (
				<TextRow
					// eslint-disable-next-line react/no-array-index-key
					key={`tag${tagIndex}`}
					width={width}
					backgroundColor={background}
					left={[...lane(graph.nodeRow, '|'), cell]}
				/>
			))}
			<TextRow
				width={width}
				backgroundColor={background}
				left={[
					...lane(graph.nodeRow, commit.pending ? 'o' : '*'),
					{
						text: commit.message,
						color: commit.pending ? theme.dim : theme.text,
						bold: true,
					},
				]}
				right={countCells}
			/>
			<TextRow
				width={width}
				backgroundColor={background}
				left={[
					...lane(graph.edgeRow, commit.pending ? ' ' : '|'),
					{ text: commit.author, color: theme.dim, italic: true },
				]}
				right={
					commit.date.length > 0
						? [{ text: commit.date, color: theme.dim }]
						: []
				}
			/>
		</Box>
	);
}

export default function CommitList({
	commits,
	selectedIndex,
	width,
	height,
	isActive = true,
}: Props) {
	const graph = buildGraph(commits);
	// One width for every row keeps messages aligned even as branches come and go.
	let laneCount = 1;
	for (const row of graph) {
		laneCount = Math.max(laneCount, row.nodeRow.length, row.edgeRow.length);
	}

	const rows = commits.flatMap((commit, index) => {
		const graphRow = graph[index];
		return graphRow === undefined ? [] : [{ commit, graphRow }];
	});

	return (
		<ScrollableArea
			width={width}
			height={height}
			isActive={isActive}
			step={commitStep}
		>
			{contentWidth =>
				rows.map(({ commit, graphRow }, index) => (
					<CommitRow
						key={`${commit.hash}-${commit.message}`}
						commit={commit}
						isSelected={index === selectedIndex}
						width={contentWidth}
						graph={graphRow}
						laneCount={laneCount}
						isColored={laneCount > 1}
					/>
				))
			}
		</ScrollableArea>
	);
}
