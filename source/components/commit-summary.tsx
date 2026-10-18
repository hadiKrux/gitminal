import React from 'react';
import { Box } from 'ink';
import Divider from 'ink-divider';
import { theme } from '../theme.js';
import type { ChangedFile, CommitMeta } from '../data/types.js';
import TextRow from './text-row.js';

type Props = {
	readonly meta: CommitMeta;
	readonly changedFiles: ChangedFile[];
	readonly selectedFile: number;
	readonly width: number;
};

const label = (text: string) => ({ text: text.padStart(12), color: theme.dim });

export default function CommitSummary({
	meta,
	changedFiles,
	selectedFile,
	width,
}: Props) {
	const contentWidth = Math.max(0, width - 2);

	return (
		<Box flexDirection="column" paddingX={1} paddingY={1}>
			<TextRow
				width={contentWidth}
				left={[
					label('Commit Hash'),
					{ text: ' ', color: theme.text },
					{ text: meta.hash, color: theme.text },
				]}
			/>
			<TextRow
				width={contentWidth}
				left={[
					label('Tree'),
					{ text: ' ', color: theme.text },
					{ text: meta.tree, color: theme.text },
				]}
			/>
			<TextRow
				width={contentWidth}
				left={[
					label('Author'),
					{ text: ' ', color: theme.text },
					{ text: meta.author, color: theme.text },
				]}
			/>
			<TextRow
				width={contentWidth}
				left={[
					label('Date'),
					{ text: ' ', color: theme.text },
					{ text: meta.date, color: theme.text },
				]}
			/>
			<TextRow
				width={contentWidth}
				left={[
					label('Parent'),
					{ text: ' ', color: theme.text },
					{ text: meta.parent, color: theme.text },
				]}
			/>
			<TextRow
				width={contentWidth}
				left={[
					label('Stats'),
					{ text: ` ${meta.filesChanged} files changed: `, color: theme.text },
					{ text: `-${meta.deletions} `, color: theme.del },
					{ text: `+${meta.additions}`, color: theme.add },
				]}
			/>
			<Divider
				width={contentWidth}
				dividerChar="-"
				dividerColor={theme.dimmer}
				boxProps={{ marginTop: 1 }}
			/>
			{changedFiles.map((file, index) => (
				<TextRow
					key={file.path}
					width={contentWidth}
					backgroundColor={index === selectedFile ? theme.accentBg : undefined}
					left={[
						{ text: 'v ', color: theme.dim },
						{ text: file.path, color: theme.text },
					]}
					right={[
						...(file.deletions > 0
							? [{ text: `-${file.deletions} `, color: theme.del }]
							: []),
						...(file.additions > 0
							? [{ text: `+${file.additions}`, color: theme.add }]
							: []),
					]}
				/>
			))}
		</Box>
	);
}
