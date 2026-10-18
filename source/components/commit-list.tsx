import React from 'react';
import { Box, Text } from 'ink';
import { ScrollView } from 'ink-scroll-view';
import Divider from 'ink-divider';
import { theme, colorAt, tagColors, graphColors } from '../theme.js';
import type { Commit } from '../data/types.js';
import TextRow from './text-row.js';

type Props = {
	readonly commits: Commit[];
	readonly selectedIndex: number;
	readonly width: number;
	readonly height: number;
};

type RowProps = {
	readonly commit: Commit;
	readonly isSelected: boolean;
	readonly index: number;
	readonly width: number;
};

function CommitRow({ commit, isSelected, index, width }: RowProps) {
	const nodeColor = colorAt(graphColors, index);
	const background = isSelected ? theme.accentBg : undefined;

	const tags = commit.tags.map((tag, tagIndex) => ({
		text: ` ${tag}`,
		color: colorAt(tagColors, tagIndex),
	}));

	return (
		<Box flexDirection="column">
			<TextRow
				width={width}
				backgroundColor={background}
				left={[
					{ text: `${commit.pending ? 'o' : '*'} `, color: nodeColor },
					{
						text: commit.message,
						color: commit.pending ? theme.dim : theme.text,
						bold: true,
					},
				]}
				right={[
					...(commit.fileCount === undefined
						? []
						: [{ text: ` ${commit.fileCount}`, color: theme.fileCount }]),
					...(commit.pending ? [] : tags),
				]}
			/>
			<TextRow
				width={width}
				backgroundColor={background}
				left={[
					{ text: `${commit.pending ? ' ' : '|'} `, color: nodeColor },
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
}: Props) {
	const contentWidth = Math.max(0, width);

	return (
		<Box width={width} height={height} flexDirection="column">
			<Box paddingX={1}>
				<Text backgroundColor={theme.bgPanel} color={theme.text}>
					{' Commits '}
				</Text>
				<Text color={theme.dim}>{' Files '}</Text>
			</Box>
			<Divider
				width={contentWidth}
				dividerChar="-"
				dividerColor={theme.dimmer}
			/>
			<ScrollView width={contentWidth} height={Math.max(1, height - 2)}>
				{commits.map((commit, index) => (
					<CommitRow
						key={`${commit.hash}-${commit.message}`}
						commit={commit}
						isSelected={index === selectedIndex}
						index={index}
						width={contentWidth}
					/>
				))}
			</ScrollView>
		</Box>
	);
}
