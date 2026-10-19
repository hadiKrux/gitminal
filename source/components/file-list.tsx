import React, { useRef, useState } from 'react';
import { Box, type DOMElement } from 'ink';
import { useMouseClick, useMouseHover } from '../hooks/use-mouse.js';
import { theme } from '../theme.js';
import { icons } from '../icons.js';
import type { FileGroup } from '../data/types.js';
import ScrollableArea from './scrollable-area.js';
import TextRow from './text-row.js';

type Props = {
	readonly groups: readonly FileGroup[];
	readonly width: number;
	readonly height: number;
	/** When false, e.g. while an overlay owns input, interaction is disabled. */
	readonly isActive?: boolean;
};

type HeaderProps = {
	readonly group: FileGroup;
	readonly isCollapsed: boolean;
	readonly width: number;
	readonly onToggle: () => void;
};

/** A clickable group header that expands or collapses its file list. */
function GroupHeader({ group, isCollapsed, width, onToggle }: HeaderProps) {
	const ref = useRef<DOMElement>(null);
	const [isHovered, setIsHovered] = useState(false);

	useMouseHover(ref, setIsHovered);
	useMouseClick(ref, onToggle);

	return (
		<Box ref={ref}>
			<TextRow
				width={width}
				backgroundColor={isHovered ? theme.accentBg : undefined}
				left={[
					{ text: `${group.label} `, color: theme.labelFg, bold: true },
					{ text: `(${group.files.length})`, color: theme.dimmer },
				]}
				right={[
					{
						text: isCollapsed ? icons.sectionCollapsed : icons.sectionExpanded,
						color: theme.dimmer,
					},
				]}
			/>
		</Box>
	);
}

/**
 * Working-tree files grouped by status. Each group header toggles its files on
 * click; the whole list scrolls like the commit list.
 */
export default function FileList({
	groups,
	width,
	height,
	isActive = true,
}: Props) {
	const [collapsed, setCollapsed] = useState<Readonly<Record<string, boolean>>>(
		{},
	);

	const toggle = (category: string): void => {
		setCollapsed(current => ({ ...current, [category]: !current[category] }));
	};

	return (
		<ScrollableArea width={width} height={height} isActive={isActive}>
			{contentWidth =>
				groups.map((group, index) => {
					const isCollapsed = collapsed[group.category] === true;

					return (
						<Box
							key={group.category}
							flexDirection="column"
							marginTop={index === 0 ? 0 : 1}
						>
							<GroupHeader
								group={group}
								isCollapsed={isCollapsed}
								width={contentWidth}
								onToggle={() => {
									toggle(group.category);
								}}
							/>
							{isCollapsed
								? null
								: group.files.map(file => (
										<TextRow
											key={file}
											width={contentWidth}
											left={[
												{ text: '  ', color: theme.dim },
												{ text: file, color: theme.dim },
											]}
										/>
								  ))}
						</Box>
					);
				})
			}
		</ScrollableArea>
	);
}
