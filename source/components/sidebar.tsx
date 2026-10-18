import React from 'react';
import { Box } from 'ink';
import { ScrollView } from 'ink-scroll-view';
import { theme } from '../theme.js';
import type { SidebarSection } from '../data/types.js';
import TextRow from './text-row.js';

type Props = {
	readonly sections: SidebarSection[];
	readonly width: number;
	readonly height: number;
};

export default function Sidebar({ sections, width, height }: Props) {
	const contentWidth = Math.max(0, width - 2);

	return (
		<Box width={width} height={height} flexDirection="column" paddingX={1}>
			<TextRow
				width={contentWidth}
				left={[{ text: 'Locations', color: theme.text }]}
				right={[{ text: 'o', color: theme.dim }]}
			/>
			<ScrollView width={contentWidth} height={Math.max(1, height - 1)}>
				{sections.map(section => (
					<Box key={section.title} flexDirection="column" marginTop={1}>
						<TextRow
							width={contentWidth}
							left={[
								{ text: section.collapsed ? '> ' : 'v ', color: theme.dimmer },
								{ text: section.title, color: theme.labelFg, bold: true },
								{ text: ` (${section.count})`, color: theme.dimmer },
							]}
						/>
						{section.items.map(item => (
							<TextRow
								key={`${section.title}/${item.label}/${item.depth}`}
								width={contentWidth}
								backgroundColor={item.active ? theme.accentBg : undefined}
								left={[
									{
										text: ` ${'  '.repeat(item.depth)}${
											item.depth > 0 ? '- ' : ''
										}${item.label}`,
										color: item.active ? theme.text : theme.dim,
									},
								]}
							/>
						))}
					</Box>
				))}
			</ScrollView>
		</Box>
	);
}
