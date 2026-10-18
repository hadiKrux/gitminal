import React from 'react';
import { commandSections, type CommandId } from '../commands.js';
import MenuModal, { type MenuSection } from './menu-modal.js';

type Props = {
	readonly onSelect: (id: CommandId) => void;
	readonly onClose: () => void;
};

const sections: ReadonlyArray<MenuSection<CommandId>> = commandSections.map(
	section => ({
		title: section.title,
		items: section.commands.map(command => ({
			id: command.id,
			label: command.label,
			isDanger: command.id === 'push-force',
		})),
	}),
);

/** The remote operations menu: pull and push variants, grouped by direction. */
export default function CommandMenu({ onSelect, onClose }: Props) {
	return (
		<MenuModal
			title="Remote operations"
			sections={sections}
			onSelect={onSelect}
			onClose={onClose}
		/>
	);
}
