import React from 'react';
import { menuSections, type CommandId } from '../commands.js';
import MenuModal, { type MenuSection } from './menu-modal.js';

type Props = {
	readonly onSelect: (id: CommandId) => void;
	readonly onClose: () => void;
};

const sections: ReadonlyArray<MenuSection<CommandId>> = menuSections.map(
	section => ({
		title: section.title,
		items: section.commands.map(command => ({
			id: command.id,
			label: command.label,
			isDanger: command.isDanger,
		})),
	}),
);

/**
 * The command list opened from the toolbar's `...` button.
 *
 * It started as the remote operations menu and keeps that name for the command
 * palette ticket. Only the remote and branch entries appear here: the modal
 * has no height cap, so the full catalog belongs to the scrollable palette.
 * This surface also keeps the pre-existing branch behavior: it has no disabled
 * state, so switch-branch still opens its picker even when the palette would
 * dim it. The Branch section reuses the same modal and keybindings so branch
 * actions are reachable without the mouse.
 */
export default function RemoteMenu({ onSelect, onClose }: Props) {
	return (
		<MenuModal
			title="Commands"
			sections={sections}
			onSelect={onSelect}
			onClose={onClose}
		/>
	);
}
