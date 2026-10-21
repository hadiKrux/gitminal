import React from 'react';
import { commandSections, type CommandId } from '../commands.js';
import MenuModal, { type MenuSection } from './menu-modal.js';

type Props = {
	readonly onSelect: (id: CommandId) => void;
	readonly onClose: () => void;
};

const sections: ReadonlyArray<MenuSection<CommandId>> = commandSections
	.filter(section => section.title === 'Commit')
	.map(section => ({
		title: section.title,
		items: section.commands.map(command => ({
			id: command.id,
			label: command.label,
			isDanger: command.isDanger,
		})),
	}));

/**
 * The commit menu: every command in the catalog's Commit section.
 *
 * Membership comes from the section itself, so adding a commit variant to
 * `commands.ts` makes it appear here without a second list or predicate.
 */
export default function CommitMenu({ onSelect, onClose }: Props) {
	return (
		<MenuModal
			title="Commit"
			sections={sections}
			onSelect={onSelect}
			onClose={onClose}
		/>
	);
}
