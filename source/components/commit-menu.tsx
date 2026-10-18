import React from 'react';
import {
	commitOptionSections,
	type CommitOptionId,
} from '../commit-options.js';
import MenuModal, { type MenuSection } from './menu-modal.js';

type Props = {
	readonly onSelect: (id: CommitOptionId) => void;
	readonly onClose: () => void;
};

const sections: ReadonlyArray<MenuSection<CommitOptionId>> =
	commitOptionSections.map(section => ({
		title: section.title,
		items: section.items,
	}));

/** The commit menu: the default commit and the hook-skipping variant. */
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
