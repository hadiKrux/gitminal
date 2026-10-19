import React, { useState } from 'react';
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
	const [selected, setSelected] = useState(0);
	const selectedItem = items[selected];

	const move = (delta: number): void => {
		setSelected(current =>
			Math.min(items.length - 1, Math.max(0, current + delta)),
		);
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
									setSelected(items.indexOf(item));
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
