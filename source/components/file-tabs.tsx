import React from 'react';
import { Box } from 'ink';
import { Tabs, Tab, type TabsProps } from 'ink-tab';
import { theme } from '../theme.js';
import { noop } from '../noop.js';

type Props = {
	readonly files: string[];
	readonly activeFile: string;
	readonly width: number;
};

const TabsRow = Tabs as React.ComponentType<
	TabsProps & { flexShrink?: number }
>;

export default function FileTabs({ files, activeFile, width }: Props) {
	return (
		<Box width={width} height={1} overflow="hidden">
			<TabsRow
				isFocused={false}
				showIndex={false}
				flexShrink={0}
				defaultValue={activeFile}
				colors={{
					activeTab: { color: theme.text, backgroundColor: theme.bgPanel },
				}}
				onChange={noop}
			>
				{files.map(file => (
					<Tab key={file} name={file}>
						{file}
					</Tab>
				))}
			</TabsRow>
		</Box>
	);
}
