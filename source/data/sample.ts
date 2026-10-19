import type { SidebarSection } from './types.js';

/**
 * Placeholder sidebar content until milestone 8 reads real refs.
 *
 * The commit list, working tree, and diffs all come from git now, so the
 * sidebar is the last surface still rendering sample data; ticket 08 replaces
 * this file with `source/git/refs.ts` output and deletes the module.
 */
export const sidebarSections: SidebarSection[] = [
	{
		title: 'BRANCHES',
		count: 2,
		collapsed: false,
		items: [
			{ label: 'develop', depth: 0 },
			{ label: 'master', depth: 0, active: true },
		],
	},
	{
		title: 'REMOTES',
		count: 1,
		collapsed: false,
		items: [
			{ label: 'origin', depth: 0 },
			{ label: 'develop', depth: 1 },
			{ label: 'master', depth: 1, active: true },
		],
	},
	{
		title: 'TAGS',
		count: 22,
		collapsed: false,
		items: [
			{ label: '1.0.0', depth: 0 },
			{ label: '1.2.0', depth: 0 },
			{ label: '1.3.0', depth: 0 },
			{ label: '1.4.0', depth: 0 },
			{ label: '1.4.1', depth: 0 },
			{ label: '1.4.2', depth: 0 },
			{ label: '2.0.0', depth: 0 },
			{ label: '2.1.0', depth: 0 },
			{ label: '2.2.0', depth: 0 },
			{ label: '3.0.0', depth: 0 },
			{ label: '4.0.0', depth: 0 },
			{ label: '4.1.0', depth: 0 },
			{ label: '4.2.0', depth: 0 },
		],
	},
	{ title: 'STASHES', count: 0, collapsed: false, items: [] },
	{ title: 'SUBMODULES', count: 0, collapsed: false, items: [] },
	{ title: 'WORKTREES', count: 1, collapsed: false, items: [] },
];
