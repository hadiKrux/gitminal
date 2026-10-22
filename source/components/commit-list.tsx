import React, { useCallback, useEffect, useRef } from 'react';
import { Box, Text, type DOMElement } from 'ink';
import { theme, colorAt, tagColors, graphColors, tint } from '../theme.js';
import type { Commit } from '../data/types.js';
import { buildGraph, type GraphRow } from '../data/graph.js';
import { useKeyboardShortcuts } from '../hooks/use-keyboard-shortcuts.js';
import { useMouseClick } from '../hooks/use-mouse.js';
import ScrollableArea, {
	type ScrollableAreaHandle,
} from './scrollable-area.js';
import TextRow, { type Cell } from './text-row.js';

type Props = {
	readonly commits: readonly Commit[];
	readonly selectedIndex: number;
	readonly width: number;
	readonly height: number;
	/** True when older history exists; the footer offers to load it. */
	readonly hasMore: boolean;
	/** True while the next page is in flight. */
	readonly isLoadingMore: boolean;
	/** When false, e.g. while an overlay owns input, interaction is disabled. */
	readonly isActive?: boolean;
	/** Select a commit by hash; the pending row participates like any other. */
	readonly onSelectCommit: (hash: string) => void;
	/** Append the next history page when the selection reaches the end. */
	readonly onLoadMore: () => void;
};

type RowProps = {
	readonly commit: Commit;
	readonly isSelected: boolean;
	readonly width: number;
	readonly graph: GraphRow;
	/** Columns the gutter is padded to, so every message starts at the same x. */
	readonly laneCount: number;
	/** One palette color per lane; off for a linear history, which is one line. */
	readonly isColored: boolean;
	readonly onSelect: () => void;
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
	onSelect,
}: RowProps) {
	const rowRef = useRef<DOMElement>(null);
	useMouseClick(rowRef, onSelect);

	const background = isSelected ? theme.accentBg : undefined;
	const lane = (chars: readonly string[], nodeChar: string): Cell[] =>
		gutter(chars, nodeChar, laneCount, isColored);

	const countCells: Cell[] =
		commit.fileCount === undefined
			? []
			: [chip(String(commit.fileCount), theme.fileCount)];

	/*
	 * The pending row is a work in progress without a diff, so it carries no
	 * stats; a real commit always read a numstat block (even a zero), so the
	 * presence of the counts is what decides the chips.
	 */
	const statCells: Cell[] =
		commit.pending === true ||
		commit.additions === undefined ||
		commit.deletions === undefined
			? []
			: [
					chip(`+${commit.additions}`, theme.add),
					chip(`-${commit.deletions}`, theme.del),
			  ];

	// Tags and branches ride above the message as chips, one per row, so a
	// commit's message and file count keep the full row width.
	const tagRows: Cell[] = commit.tags.map((tag, tagIndex) =>
		chip(tag, colorAt(tagColors, tagIndex)),
	);

	return (
		<Box ref={rowRef} flexDirection="column">
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
				right={[...countCells, ...statCells]}
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

/**
 * The commit history list.
 *
 * While the COMMITS tab is active the arrow keys move the selection (clamped
 * to the list) instead of scrolling, and the list scrolls just enough to keep
 * the selected row in view; page-up/page-down still scroll by a viewport. The
 * whole row is a click target, so the pointer and the arrows drive the same
 * selection.
 *
 * An unborn branch has no history but still has a pending row: the quiet
 * "no commits yet" line sits above that row, which stays selectable and keeps
 * counting the working tree until the first commit exists.
 *
 * History is paged: reaching the bottom with more commits left asks for the
 * next page, and a one-row footer explains whether it is available or being
 * loaded. The footer takes a row from the scroll viewport so the list area
 * never grows past its panel.
 */
export default function CommitList({
	commits,
	selectedIndex,
	width,
	height,
	hasMore,
	isLoadingMore,
	isActive = true,
	onSelectCommit,
	onLoadMore,
}: Props) {
	const areaRef = useRef<ScrollableAreaHandle>(null);
	const footerRef = useRef<DOMElement>(null);
	const graph = buildGraph(commits);
	const previousSelectedIndexRef = useRef(selectedIndex);
	const hasHistory = commits.some(commit => commit.pending !== true);
	const showEmptyState = !hasHistory && height > 1;
	// The footer needs a row of its own; on a terminal too short for it the
	// list keeps its one usable row and the availability note is skipped.
	const showFooter =
		(hasMore || isLoadingMore) && height > (showEmptyState ? 2 : 1);
	const listHeight = Math.max(
		1,
		height - (showEmptyState ? 1 : 0) - (showFooter ? 1 : 0),
	);
	// One width for every row keeps messages aligned even as branches come and go.
	let laneCount = 1;
	for (const row of graph) {
		laneCount = Math.max(laneCount, row.nodeRow.length, row.edgeRow.length);
	}

	const rows = commits.flatMap((commit, index) => {
		const graphRow = graph[index];
		return graphRow === undefined ? [] : [{ commit, graphRow }];
	});

	const move = useCallback(
		(delta: number) => {
			const lastIndex = Math.max(0, commits.length - 1);

			// Down on the bottom row asks for the next page instead of doing
			// nothing. The row stays selected until the new page arrives.
			if (delta > 0 && hasMore && selectedIndex >= lastIndex) {
				if (!isLoadingMore) {
					onLoadMore();
				}

				return;
			}

			const next = Math.max(0, Math.min(selectedIndex + delta, lastIndex));
			const commit = commits[next];

			if (next === selectedIndex || commit === undefined) {
				return;
			}

			onSelectCommit(commit.hash);
		},
		[
			commits,
			hasMore,
			isLoadingMore,
			onLoadMore,
			onSelectCommit,
			selectedIndex,
		],
	);

	// Revealing after the render that applies the new selection covers every
	// way it can move (arrows, clicks, refresh, resize) with one path. A click
	// selects through the row, not through `move`, so this must not live there.
	useEffect(() => {
		areaRef.current?.reveal(selectedIndex);
	}, [commits, height, selectedIndex]);

	/*
	 * Arriving on the last row asks for the next page here as well as from the
	 * down key. The previous index is remembered so a failed load, a refresh,
	 * or a resize cannot retry while the selection has not moved again: only a
	 * transition onto the last row starts a read.
	 */
	useEffect(() => {
		const previous = previousSelectedIndexRef.current;
		previousSelectedIndexRef.current = selectedIndex;

		if (
			selectedIndex === previous ||
			selectedIndex !== commits.length - 1 ||
			!hasMore ||
			!isActive ||
			isLoadingMore
		) {
			return;
		}

		onLoadMore();
	}, [
		commits.length,
		hasMore,
		isActive,
		isLoadingMore,
		onLoadMore,
		selectedIndex,
	]);

	// The footer is also the wheel/page-down target: a user who never presses
	// down at the bottom can click the availability line to request the page.
	useMouseClick(footerRef, () => {
		if (hasMore && !isLoadingMore) {
			onLoadMore();
		}
	});

	useKeyboardShortcuts(
		{
			'move-down'() {
				move(1);
			},
			'move-up'() {
				move(-1);
			},
		},
		{ isActive },
	);

	return (
		<Box flexDirection="column" width={width} height={height}>
			{showEmptyState ? (
				<Box paddingLeft={2} flexShrink={0}>
					<Text color={theme.dimmer}>no commits yet</Text>
				</Box>
			) : null}
			<ScrollableArea
				ref={areaRef}
				width={width}
				height={listHeight}
				isActive={isActive}
				scrollOnArrows={false}
				pageStep={Math.max(1, listHeight)}
			>
				{contentWidth =>
					rows.map(({ commit, graphRow }, index) => (
						<CommitRow
							key={commit.hash}
							commit={commit}
							isSelected={index === selectedIndex}
							width={contentWidth}
							graph={graphRow}
							laneCount={laneCount}
							isColored={laneCount > 1}
							onSelect={() => {
								onSelectCommit(commit.hash);
							}}
						/>
					))
				}
			</ScrollableArea>
			{showFooter ? (
				<Box ref={footerRef} paddingLeft={2} flexShrink={0}>
					<Text color={theme.dimmer} wrap="truncate-end">
						{isLoadingMore
							? 'loading older commits...'
							: 'older commits available: click or select the last row'}
					</Text>
				</Box>
			) : null}
		</Box>
	);
}
