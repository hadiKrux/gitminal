import React, { useEffect, useState } from 'react';
import { theme } from '../theme.js';
import { useKeyboardShortcuts } from '../hooks/use-keyboard-shortcuts.js';
import MenuRow from './menu-row.js';
import ModalFrame, {
	BlankRow,
	FrameRow,
	Line,
	Rule,
	contentWidth,
} from './modal-frame.js';

export type MenuItem<Id extends string = string> = {
	readonly id: Id;
	readonly label: string;
	readonly isDanger?: boolean;
};

export type MenuSection<Id extends string = string> = {
	readonly title: string;
	readonly items: ReadonlyArray<MenuItem<Id>>;
};

type Props<Id extends string> = {
	readonly title: string;
	readonly sections: ReadonlyArray<MenuSection<Id>>;
	readonly onSelect: (id: Id) => void;
	readonly onClose: () => void;
};

/**
 * Centered modal listing selectable commands grouped by section.
 *
 * Keyboard and mouse both drive the same selection: arrows (or the keybinding
 * equivalents) move it, enter runs the highlighted command, and the mouse
 * highlights on hover and runs on click.
 */
export default function MenuModal<Id extends string>({
	title,
	sections,
	onSelect,
	onClose,
}: Props<Id>) {
	const items = sections.flatMap(section => section.items);

	// Track the highlighted item by id, not index: the branch picker can
	// refresh while it is open, and the same index then names a different
	// branch. An id keeps the highlight on the item the user picked.
	const [selectedId, setSelectedId] = useState(items[0]?.id);
	const selectedIndex = items.findIndex(item => item.id === selectedId);
	// A vanished selection falls back to the first item; the effect below
	// writes that fallback back into state so later moves start from it.
	const activeIndex = selectedIndex === -1 ? 0 : selectedIndex;
	const selectedItem = items[activeIndex];
	const activeId = selectedItem?.id;

	useEffect(() => {
		if (activeId !== selectedId) {
			setSelectedId(activeId);
		}
	}, [activeId, selectedId]);

	const move = (delta: number): void => {
		const next = Math.min(items.length - 1, Math.max(0, activeIndex + delta));
		const item = items[next];
		if (item !== undefined) {
			setSelectedId(item.id);
		}
	};

	useKeyboardShortcuts({
		'move-down'() {
			move(1);
		},
		'move-up'() {
			move(-1);
		},
		'activate-selection'() {
			if (selectedItem !== undefined) {
				onSelect(selectedItem.id);
			}
		},
		'close-overlay': onClose,
	});

	return (
		<ModalFrame title={title}>
			{sections.map(section => (
				<React.Fragment key={section.title}>
					<FrameRow>
						<Line
							segments={[
								{
									text: section.title.toUpperCase(),
									color: theme.labelFg,
									isBold: true,
								},
							]}
						/>
					</FrameRow>
					{section.items.map(item => (
						<FrameRow key={item.id}>
							<MenuRow
								label={item.label}
								width={contentWidth}
								isSelected={selectedItem?.id === item.id}
								isDanger={item.isDanger}
								onPress={() => {
									onSelect(item.id);
								}}
								onHover={() => {
									setSelectedId(item.id);
								}}
							/>
						</FrameRow>
					))}
					<BlankRow />
				</React.Fragment>
			))}
			<FrameRow>
				<Rule />
			</FrameRow>
			<FrameRow>
				<Line
					segments={[
						{ text: 'enter', color: theme.accent, isBold: true },
						{ text: ' run   ', color: theme.dim },
						{ text: 'esc', color: theme.accent, isBold: true },
						{ text: ' close', color: theme.dim },
					]}
				/>
			</FrameRow>
		</ModalFrame>
	);
}
