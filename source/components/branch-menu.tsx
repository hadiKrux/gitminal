import React from 'react';
import MenuModal, { type MenuSection } from './menu-modal.js';

type Props = {
	/**
	 * Branch the menu was opened from, or undefined for the command list's
	 * "switch branch" picker. The picker lists every local branch; the ref
	 * mode offers the checkout and create actions for that one branch.
	 */
	readonly refName: string | undefined;
	readonly branches: readonly string[];
	readonly onCheckout: (name: string) => void;
	readonly onNewBranch: () => void;
	readonly onClose: () => void;
};

type MenuItem = {
	readonly id: string;
	readonly label: string;
};

/**
 * The branch action menu.
 *
 * Two shapes share the same modal: a picker for "switch branch" and the
 * per-ref menu opened from the sidebar. Delete and rename will append actions
 * to the same item list, so their confirmation flows do not need a new frame.
 */
export default function BranchMenu({
	refName,
	branches,
	onCheckout,
	onNewBranch,
	onClose,
}: Props) {
	// Ids are derived from the branch name rather than the list index: a
	// watcher refresh can reorder or replace `branches` while the picker is
	// open, and the highlighted row must still name the same branch. Branch
	// names cannot contain a colon, so the prefix is unambiguous.
	const checkoutItems: readonly MenuItem[] =
		refName === undefined
			? branches.map(name => ({
					id: `checkout:${name}`,
					label: name,
			  }))
			: [{ id: `checkout:${refName}`, label: `checkout ${refName}` }];

	const createItem: MenuItem = {
		id: 'new-branch',
		label: refName === undefined ? 'new branch' : 'new branch here',
	};

	const switchSection: MenuSection = {
		title: refName === undefined ? 'Switch branch' : 'Branch',
		items: checkoutItems,
	};
	const createSection: MenuSection = {
		title: 'Create',
		items: [createItem],
	};
	const sections: readonly MenuSection[] =
		checkoutItems.length > 0 ? [switchSection, createSection] : [createSection];

	const handleSelect = (id: string): void => {
		if (id === createItem.id) {
			onNewBranch();
			return;
		}

		if (id.startsWith('checkout:')) {
			onCheckout(id.slice('checkout:'.length));
		}
	};

	return (
		<MenuModal
			title={refName === undefined ? 'Switch branch' : 'Branch'}
			sections={sections}
			onSelect={handleSelect}
			onClose={onClose}
		/>
	);
}
