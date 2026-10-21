/**
 * Operations the app can run, plus the state that decides whether they can.
 *
 * A single list backs the toolbar buttons, the remote menu, the commit menu,
 * and the command palette, so adding an operation is one entry here rather
 * than a new bespoke button. Sections are derived from the entries themselves:
 * the menu can then render a Branch group beside the remote groups without a
 * second hardcoded title list.
 */
export type CommandId =
	| 'pull'
	| 'fetch'
	| 'fetch-prune'
	| 'push'
	| 'push-force'
	| 'push-no-verify'
	| 'switch-branch'
	| 'new-branch'
	| 'stage-all'
	| 'unstage-all'
	| 'discard-all'
	| 'commit'
	| 'commit-no-verify'
	| 'refresh'
	| 'toggle-console';

/**
 * The repository and editor state a command's availability is read from.
 *
 * The palette computes this once per render; commands only declare a reason,
 * so the catalog stays independent of the hooks that own the real state.
 */
export type CommandAvailability = {
	/** Whether a normal repository view is loaded. */
	readonly isRepo: boolean;
	/** Whether the index holds at least one change. */
	readonly hasStaged: boolean;
	/** Whether any path has work a `git add` would record. */
	readonly hasUnstaged: boolean;
	/** Whether any staged path can be unstaged without recreating a conflict. */
	readonly hasUnstageable: boolean;
	/** Whether any non-conflicted path has worktree changes to discard. */
	readonly hasDiscardable: boolean;
	/** Whether the working tree has unmerged paths. */
	readonly hasConflicts: boolean;
	/** Whether the commit message has any non-whitespace text. */
	readonly hasMessage: boolean;
	/** Whether at least one other local branch can be switched to. */
	readonly hasBranches: boolean;
};

export type AppCommand = {
	readonly id: CommandId;
	readonly label: string;
	readonly section: string;
	/** Only the default remote operations sit on the toolbar. */
	readonly isToolbar?: boolean;
	/** Whether the command also appears in the remote and branch menu. */
	readonly isMenu?: boolean;
	readonly isDanger?: boolean;
	/**
	 * Why the command cannot run, or undefined when it can. A reason rather
	 * than a boolean so the palette can explain a dimmed row instead of only
	 * disabling it.
	 */
	readonly enabledWhen?: (state: CommandAvailability) => string | undefined;
};

/** Commit-message gate shared by the normal and hook-skipping variants. */
const commitUnavailable = (state: CommandAvailability): string | undefined => {
	if (!state.hasStaged && !state.hasConflicts) {
		return 'nothing to commit';
	}

	return state.hasMessage ? undefined : 'message is empty';
};

export const commands: readonly AppCommand[] = [
	{
		id: 'pull',
		label: 'pull',
		section: 'Pull',
		isToolbar: true,
		isMenu: true,
	},
	{ id: 'fetch', label: 'fetch', section: 'Pull', isMenu: true },
	{ id: 'fetch-prune', label: 'fetch --prune', section: 'Pull', isMenu: true },
	{
		id: 'push',
		label: 'push',
		section: 'Push',
		isToolbar: true,
		isMenu: true,
	},
	{
		id: 'push-force',
		label: 'push --force',
		section: 'Push',
		isMenu: true,
		isDanger: true,
	},
	{
		id: 'push-no-verify',
		label: 'push --no-verify',
		section: 'Push',
		isMenu: true,
	},
	{
		id: 'switch-branch',
		label: 'switch branch',
		section: 'Branch',
		isMenu: true,
		enabledWhen(state) {
			if (!state.isRepo) {
				return 'not in a repository';
			}

			return state.hasBranches ? undefined : 'no other branches';
		},
	},
	{
		id: 'new-branch',
		label: 'new branch',
		section: 'Branch',
		isMenu: true,
		enabledWhen(state) {
			return state.isRepo ? undefined : 'not in a repository';
		},
	},
	{
		id: 'stage-all',
		label: 'stage all',
		section: 'Working Tree',
		enabledWhen(state) {
			return state.hasUnstaged ? undefined : 'nothing to stage';
		},
	},
	{
		id: 'unstage-all',
		label: 'unstage all',
		section: 'Working Tree',
		enabledWhen(state) {
			if (!state.hasStaged) {
				return 'nothing staged';
			}

			return state.hasUnstageable ? undefined : 'merge-resolved only';
		},
	},
	{
		id: 'discard-all',
		label: 'discard all',
		section: 'Working Tree',
		isDanger: true,
		enabledWhen(state) {
			return state.hasDiscardable ? undefined : 'nothing to discard';
		},
	},
	{
		id: 'commit',
		label: 'commit',
		section: 'Commit',
		enabledWhen: commitUnavailable,
	},
	{
		id: 'commit-no-verify',
		label: 'commit --no-verify',
		section: 'Commit',
		isDanger: true,
		enabledWhen: commitUnavailable,
	},
	{ id: 'refresh', label: 'refresh', section: 'App' },
	{ id: 'toggle-console', label: 'toggle console', section: 'App' },
];

export type CommandSection = {
	readonly title: string;
	readonly commands: readonly AppCommand[];
};

/**
 * Section titles in first-appearance order.
 *
 * Remote groups stay first so the menu's initial selection is still `pull`;
 * the Branch, Working Tree, Commit, and App groups follow them.
 */
const sectionTitles = [...new Set(commands.map(command => command.section))];

export const commandSections: readonly CommandSection[] = sectionTitles.map(
	title => ({
		title,
		commands: commands.filter(command => command.section === title),
	}),
);

/**
 * The remote and branch menu's surface.
 *
 * The palette shows the full catalog; the toolbar's `...` menu has no height
 * cap or scrolling, so it stays with the remote operations and branch actions
 * that predate the palette. Entries opt in with `isMenu`, and a section whose
 * entries all opt out disappears rather than rendering an empty header.
 */
export const menuSections: readonly CommandSection[] = commandSections
	.map(section => ({
		title: section.title,
		commands: section.commands.filter(command => command.isMenu === true),
	}))
	.filter(section => section.commands.length > 0);

export const toolbarCommands: readonly AppCommand[] = commands.filter(
	command => command.isToolbar === true,
);

/** Every command in the remote menu, in display order. */
export const menuCommands: readonly AppCommand[] = menuSections.flatMap(
	section => section.commands,
);
