import React from 'react';
import { Box } from 'ink';
import { ScrollView } from 'ink-scroll-view';
import { theme } from '../theme.js';
import { icons } from '../icons.js';
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
			<ScrollView width={contentWidth} height={Math.max(1, height)}>
				{sections.map((section, index) => {
					const isExpanded = !section.collapsed && section.items.length > 0;

					return (
						<Box
							key={section.title}
							flexDirection="column"
							marginTop={index === 0 ? 0 : 1}
						>
							<TextRow
								width={contentWidth}
								left={[
									{ text: section.title, color: theme.labelFg, bold: true },
									{ text: ` (${section.count})`, color: theme.dimmer },
								]}
								right={[
									{
										text: isExpanded
											? icons.sectionExpanded
											: icons.sectionCollapsed,
										color: theme.dimmer,
									},
								]}
							/>
							{isExpanded
								? section.items.map(item => (
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
								  ))
								: null}
						</Box>
					);
				})}
			</ScrollView>
		</Box>
	);
}
