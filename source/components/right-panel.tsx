import React from 'react';
import { Box } from 'ink';
import { ScrollView } from 'ink-scroll-view';
import Divider from 'ink-divider';
import { theme } from '../theme.js';
import type { Repo } from '../data/types.js';
import FileTabs from './file-tabs.js';
import CommitSummary from './commit-summary.js';
import CodePane from './code-pane.js';

type Props = {
	readonly repo: Repo;
	readonly width: number;
	readonly height: number;
};

export default function RightPanel({ repo, width, height }: Props) {
	return (
		<Box width={width} height={height} flexDirection="column">
			<FileTabs
				files={repo.openFiles}
				activeFile={repo.openFiles[repo.activeFile] ?? ''}
				width={width}
			/>
			<Divider width={width} dividerChar="-" dividerColor={theme.dimmer} />
			<ScrollView width={width} height={Math.max(1, height - 2)}>
				<CommitSummary
					meta={repo.meta}
					changedFiles={repo.changedFiles}
					selectedFile={repo.selectedFile}
					width={width}
				/>
				<Divider
					width={Math.max(0, width - 2)}
					dividerChar="-"
					dividerColor={theme.dimmer}
					boxProps={{
						marginLeft: 1,
						marginRight: 1,
						marginTop: 1,
						marginBottom: 1,
					}}
				/>
				<CodePane code={repo.code} language={repo.language} width={width} />
			</ScrollView>
		</Box>
	);
}
