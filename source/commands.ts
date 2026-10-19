/**
 * Operations the app can run.
 *
 * A single list backs both the toolbar buttons and the command menu, so adding
 * an operation is one entry here rather than a new bespoke button. Sections are
 * derived from the entries themselves: the menu can then render a Branch group
 * beside the remote groups without a second hardcoded title list.
 */
export type CommandId =
	| 'pull'
	| 'fetch'
	| 'fetch-prune'
	| 'push'
	| 'push-force'
	| 'push-no-verify'
	| 'switch-branch'
	| 'new-branch';

export type Command = {
	readonly id: CommandId;
	readonly label: string;
	readonly section: string;
	readonly isToolbar: boolean;
	readonly isDanger?: boolean;
};

export const commands: readonly Command[] = [
	{ id: 'pull', label: 'pull', section: 'Pull', isToolbar: true },
	{ id: 'fetch', label: 'fetch', section: 'Pull', isToolbar: false },
	{
		id: 'fetch-prune',
		label: 'fetch --prune',
		section: 'Pull',
		isToolbar: false,
	},
	{ id: 'push', label: 'push', section: 'Push', isToolbar: true },
	{
		id: 'push-force',
		label: 'push --force',
		section: 'Push',
		isToolbar: false,
		isDanger: true,
	},
	{
		id: 'push-no-verify',
		label: 'push --no-verify',
		section: 'Push',
		isToolbar: false,
	},
	{
		id: 'switch-branch',
		label: 'switch branch',
		section: 'Branch',
		isToolbar: false,
	},
	{
		id: 'new-branch',
		label: 'new branch',
		section: 'Branch',
		isToolbar: false,
	},
];

export type CommandSection = {
	readonly title: string;
	readonly commands: readonly Command[];
};

/**
 * Section titles in first-appearance order.
 *
 * Remote groups stay first so the menu's initial selection is still `pull`;
 * the Branch group follows them.
 */
const sectionTitles = [...new Set(commands.map(command => command.section))];

export const commandSections: readonly CommandSection[] = sectionTitles.map(
	title => ({
		title,
		commands: commands.filter(command => command.section === title),
	}),
);

export const toolbarCommands: readonly Command[] = commands.filter(
	command => command.isToolbar,
);

/** Every command in display order, for menu selection and navigation. */
export const menuCommands: readonly Command[] = commandSections.flatMap(
	section => section.commands,
);
