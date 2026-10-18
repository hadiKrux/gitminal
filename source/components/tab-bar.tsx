import React, { useEffect, useRef } from 'react';
import { Box, type DOMElement } from 'ink';
import { Tabs, Tab } from 'ink-tab';
import {
	useMouse,
	useElementDimensions,
	useElementPosition,
} from '@zenobius/ink-mouse';
import { theme } from '../theme.js';

export type TabDef = {
	readonly name: string;
	readonly label: string;
};

type Props = {
	readonly tabs: readonly TabDef[];
	readonly active: string;
	readonly width: number;
	readonly onChange: (name: string) => void;
	/** When false, e.g. while an overlay owns input, clicks are ignored. */
	readonly isActive?: boolean;
};

/**
 * The separator ink-tab joins row tabs with. It is mirrored here so a click's
 * x-offset can be mapped back to the tab under the pointer: ink-tab renders
 * the labels itself and offers neither refs nor a controlled value, so the
 * active tab is driven by remounting it through `key`/`defaultValue`.
 */
const rowSeparator = ' | ';

/** Space added on each side of a tab label, so tabs don't sit flush together. */
const tabPadding = ' ';

const paddedLabel = (tab: TabDef): string =>
	`${tabPadding}${tab.label}${tabPadding}`;

/**
 * A row of tabs rendered by ink-tab, selectable by clicking a label.
 *
 * Keyboard navigation is turned off (empty `keyMap`); selection is owned by the
 * caller so it can be driven from clicks and from the rest of the app.
 */
export default function TabBar({
	tabs,
	active,
	width,
	onChange,
	isActive = true,
}: Props) {
	const ref = useRef<DOMElement>(null);
	const { left, top } = useElementPosition(ref, [active, width]);
	const { height } = useElementDimensions(ref, [active, width]);
	const { events } = useMouse();

	useEffect(() => {
		if (!isActive) {
			return;
		}

		const handleClick = (position: unknown, action: unknown): void => {
			if (action !== 'press') {
				return;
			}

			const { x, y } = position as { x: number; y: number };
			// Mouse coordinates are 1-based; element layout is 0-based.
			const row = y - 1;
			if (row < top || row >= top + height) {
				return;
			}

			let cursor = left;
			const column = x - 1;
			for (const [index, tab] of tabs.entries()) {
				if (index > 0) {
					cursor += rowSeparator.length;
				}

				const tabWidth = paddedLabel(tab).length;
				if (column >= cursor && column < cursor + tabWidth) {
					onChange(tab.name);
					return;
				}

				cursor += tabWidth;
			}
		};

		events.on('click', handleClick);
		return () => {
			events.off('click', handleClick);
		};
	}, [events, isActive, left, top, height, tabs, onChange]);

	return (
		<Box ref={ref} width={width} height={1}>
			<Tabs
				key={active}
				isFocused
				showIndex={false}
				defaultValue={active}
				keyMap={{ useNumbers: false, useTab: false, previous: [], next: [] }}
				colors={{
					activeTab: { color: theme.accent, backgroundColor: theme.bg },
				}}
				onChange={onChange}
			>
				{tabs.map(tab => (
					<Tab key={tab.name} name={tab.name}>
						{paddedLabel(tab)}
					</Tab>
				))}
			</Tabs>
		</Box>
	);
}
