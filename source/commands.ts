/**
 * Remote operations the app can run.
 *
 * A single list backs both the toolbar buttons and the "more" menu, so adding
 * an operation is one entry here rather than a new bespoke button.
 */
export type CommandId =
	| 'pull'
	| 'fetch'
	| 'fetch-prune'
	| 'push'
	| 'push-force'
	| 'push-no-verify';

export type Command = {
	readonly id: CommandId;
	readonly label: string;
	readonly section: string;
	readonly isToolbar: boolean;
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
	},
	{
		id: 'push-no-verify',
		label: 'push --no-verify',
		section: 'Push',
		isToolbar: false,
	},
];

export type CommandSection = {
	readonly title: string;
	readonly commands: readonly Command[];
};

const sectionTitles = ['Pull', 'Push'] as const;

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
