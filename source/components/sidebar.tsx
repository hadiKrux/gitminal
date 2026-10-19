import React, { useRef, useState } from 'react';
import { Box, type DOMElement } from 'ink';
import { ScrollView } from 'ink-scroll-view';
import { useMouseTarget } from '../hooks/use-mouse.js';
import { theme } from '../theme.js';
import { icons } from '../icons.js';
import type { SidebarSection, TreeNode } from '../data/types.js';
import TextRow from './text-row.js';

type Props = {
	readonly sections: readonly SidebarSection[];
	readonly width: number;
	readonly height: number;
	/** Called for a clicked item row; the app decides which refs are actionable. */
	readonly onSelectRef: (section: SidebarSection, item: TreeNode) => void;
	/**
	 * Whether a row has an action. Non-actionable rows (remote branches, tags)
	 * stay visible but register no hover or click, so they do not advertise a
	 * dead affordance.
	 */
	readonly isRefActionable: (
		section: SidebarSection,
		item: TreeNode,
	) => boolean;
};

type SectionHeaderProps = {
	readonly section: SidebarSection;
	readonly width: number;
	readonly isExpanded: boolean;
	readonly isCollapsible: boolean;
	readonly onToggle: () => void;
};

/**
 * A section header that collapses and expands on click.
 *
 * Hover uses the shared mouse registry, so the header is one hit target and a
 * click on it never leaks through to the row underneath. The header keeps its
 * full-width background on hover, matching the item rows below it.
 *
 * A count-only section (STASHES, SUBMODULES, WORKTREES) has no rows to hide,
 * so it renders a neutral prefix and registers no handlers: the glyph and the
 * dead toggle would only promise a disclosure that does not exist.
 */
function SectionHeader({
	section,
	width,
	isExpanded,
	isCollapsible,
	onToggle,
}: SectionHeaderProps) {
	const ref = useRef<DOMElement>(null);
	const [isHovered, setIsHovered] = useState(false);

	useMouseTarget(
		ref,
		isCollapsible
			? {
					onHover: setIsHovered,
					onPress: onToggle,
			  }
			: {},
	);

	const prefix = isCollapsible
		? isExpanded
			? icons.sectionExpanded.trim()
			: icons.sectionCollapsed.trim()
		: ' ';

	return (
		<Box ref={ref} width={width}>
			<TextRow
				width={width}
				backgroundColor={isCollapsible && isHovered ? theme.bgPanel : undefined}
				left={[
					{
						text: `${prefix} ${section.title}`,
						color: theme.labelFg,
						bold: true,
					},
				]}
				right={[{ text: String(section.count), color: theme.dimmer }]}
			/>
		</Box>
	);
}

type RefRowProps = {
	readonly item: TreeNode;
	readonly width: number;
	readonly isActionable: boolean;
	readonly onPress: () => void;
};

/**
 * One sidebar item row.
 *
 * The active branch keeps the accent background; every other row gets the
 * panel colour on hover. The highlight spans the full width so a click has an
 * unambiguous target, and the row itself is the hit target rather than a text
 * cell inside it. A non-actionable row registers no handlers, so it renders
 * plainly and a click on it does nothing at all.
 */
function RefRow({ item, width, isActionable, onPress }: RefRowProps) {
	const ref = useRef<DOMElement>(null);
	const [isHovered, setIsHovered] = useState(false);

	useMouseTarget(
		ref,
		isActionable
			? {
					onHover: setIsHovered,
					onPress,
			  }
			: {},
	);

	const background = item.active
		? isActionable && isHovered
			? theme.accent
			: theme.accentBg
		: isActionable && isHovered
		? theme.bgPanel
		: undefined;
	const color = item.active
		? isActionable && isHovered
			? theme.bg
			: theme.text
		: isActionable && isHovered
		? theme.text
		: theme.dim;

	return (
		<Box ref={ref} width={width}>
			<TextRow
				width={width}
				backgroundColor={background}
				left={[
					{
						text: ` ${'  '.repeat(item.depth)}${item.depth > 0 ? '- ' : ''}${
							item.label
						}`,
						color,
						bold: item.active,
					},
				]}
			/>
		</Box>
	);
}

type RefRowEntry = {
	readonly key: string;
	readonly item: TreeNode;
};

/**
 * Pair each section item with a key that survives a refresh.
 *
 * A remote branch label is only unique within its remote, so the key carries
 * the current depth-0 group label: `origin/main` and `upstream/main` both
 * render as `main` but key differently. The depth keeps a group row distinct
 * from a same-named branch beneath it.
 */
const refRowEntries = (section: SidebarSection): readonly RefRowEntry[] => {
	let group = '';

	return section.items.map(item => {
		if (item.depth === 0) {
			group = item.label;
		}

		return {
			key: `${section.title}/${group}/${item.depth}/${item.label}`,
			item,
		};
	});
};

/**
 * The left column: real refs grouped into collapsible sections.
 *
 * Collapse state is local because a load replaces the section list wholesale;
 * keeping it here means a refresh cannot forget which groups the user closed.
 * The `collapsed` field only supplies the initial state for a section.
 */
export default function Sidebar({
	sections,
	width,
	height,
	onSelectRef,
	isRefActionable,
}: Props) {
	const contentWidth = Math.max(0, width - 2);
	const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());

	const toggle = (title: string): void => {
		setToggled(current => {
			const next = new Set(current);
			if (next.has(title)) {
				next.delete(title);
			} else {
				next.add(title);
			}

			return next;
		});
	};

	return (
		<Box width={width} height={height} flexDirection="column" paddingX={1}>
			<ScrollView width={contentWidth} height={Math.max(1, height)}>
				{sections.map((section, index) => {
					// XOR with the data's initial value: a title in `toggled`
					// flips whatever the latest load reported, so a user's
					// collapse survives a refresh without copying state around.
					const isCollapsible = section.items.length > 0;
					const isCollapsed = toggled.has(section.title) !== section.collapsed;
					const isExpanded = isCollapsible && !isCollapsed;
					const refRows = refRowEntries(section);

					return (
						<Box
							key={section.title}
							flexDirection="column"
							marginTop={index === 0 ? 0 : 1}
						>
							<SectionHeader
								section={section}
								width={contentWidth}
								isExpanded={isExpanded}
								isCollapsible={isCollapsible}
								onToggle={() => {
									toggle(section.title);
								}}
							/>
							{isExpanded
								? refRows.map(({ key, item }) => (
										<RefRow
											key={key}
											item={item}
											width={contentWidth}
											isActionable={isRefActionable(section, item)}
											onPress={() => {
												onSelectRef(section, item);
											}}
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
