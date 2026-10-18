import process from 'node:process';
import type { Key } from 'ink';
import { appName, configFilePath, loadUserConfig } from './config.js';

/**
 * Central registry of every keyboard action in the app.
 *
 * Components never compare raw key events themselves: they register handlers
 * through `useKeyboardShortcuts` and this module decides which key triggers
 * which action. Users can rebind everything from their config file.
 */
export const actions = [
	'quit',
	'pull',
	'push',
	'toggle-mouse',
	'open-remote-menu',
	'move-down',
	'move-up',
	'activate-selection',
	'close-overlay',
] as const;

export type Action = (typeof actions)[number];

/** A single parsed key binding, e.g. `ctrl+shift+tab`. */
export type KeyDescriptor = {
	readonly base: string;
	readonly ctrl: boolean;
	readonly shift: boolean;
	readonly alt: boolean;
};

export type ResolvedKeybindings = Readonly<
	Record<Action, readonly KeyDescriptor[]>
>;

/** Action -> list of key specs, as read from the config file. */
export type KeybindingOverrides = Readonly<Record<string, readonly string[]>>;

/** Key specs used when the user does not override an action. */
export const defaultKeySpecs: Readonly<Record<Action, readonly string[]>> = {
	quit: ['q'],
	pull: ['p'],
	push: ['shift+p'],
	'toggle-mouse': ['m'],
	'open-remote-menu': ['.'],
	'move-down': ['down'],
	'move-up': ['up'],
	'activate-selection': ['enter'],
	'close-overlay': ['escape'],
};

/** Base key names that Ink exposes as boolean flags instead of characters. */
const namedKeys: Readonly<Record<string, keyof Key>> = {
	left: 'leftArrow',
	right: 'rightArrow',
	up: 'upArrow',
	down: 'downArrow',
	enter: 'return',
	escape: 'escape',
	tab: 'tab',
	backspace: 'backspace',
	delete: 'delete',
	pageup: 'pageUp',
	pagedown: 'pageDown',
};

const keyAliases: Readonly<Record<string, string>> = {
	return: 'enter',
	esc: 'escape',
	pgup: 'pageup',
	pgdn: 'pagedown',
	del: 'delete',
};

/** Parse a key spec such as `ctrl+c`, `shift+tab`, `left`, or `q`. */
export const parseKeySpec = (spec: string): KeyDescriptor => {
	let ctrl = false;
	let shift = false;
	let alt = false;
	let base = '';

	for (const rawPart of spec.split('+')) {
		const part = rawPart.trim().toLowerCase();
		if (part.length === 0) {
			continue;
		}

		switch (part) {
			case 'ctrl':
			case 'control': {
				ctrl = true;
				continue;
			}

			case 'shift': {
				shift = true;
				continue;
			}

			case 'alt':
			case 'option':
			case 'meta': {
				alt = true;
				continue;
			}

			default: {
				base = keyAliases[part] ?? part;
			}
		}
	}

	return { base, ctrl, shift, alt };
};

const isAlphanumeric = (value: string): boolean => /^[a-z\d]$/.test(value);

/** Whether an Ink key event satisfies a parsed binding. */
export const matchesKey = (
	descriptor: KeyDescriptor,
	input: string,
	key: Key,
): boolean => {
	if (descriptor.ctrl !== key.ctrl) {
		return false;
	}

	// Ink reports the escape key with `meta` set, so ignore meta there.
	const alt = key.escape ? false : key.meta;
	if (descriptor.alt !== alt) {
		return false;
	}

	const named = namedKeys[descriptor.base];
	if (named !== undefined) {
		return key[named] && key.shift === descriptor.shift;
	}

	if (descriptor.base.length === 0) {
		return false;
	}

	if (isAlphanumeric(descriptor.base)) {
		return (
			input.toLowerCase() === descriptor.base && key.shift === descriptor.shift
		);
	}

	return input === descriptor.base;
};

/** Merge user overrides onto the defaults and parse every spec. */
export const resolveKeybindings = (
	overrides: KeybindingOverrides = {},
): ResolvedKeybindings => {
	const resolved: Partial<Record<Action, readonly KeyDescriptor[]>> = {};

	for (const action of actions) {
		const specs = overrides[action] ?? defaultKeySpecs[action];
		resolved[action] = specs
			.map(spec => parseKeySpec(spec))
			.filter(descriptor => descriptor.base.length > 0);
	}

	return resolved as ResolvedKeybindings;
};

export const defaultKeybindings: ResolvedKeybindings = resolveKeybindings();

/**
 * Load key bindings from the user config, falling back to the defaults (with a
 * warning on stderr) when the file is unreadable or malformed.
 */
export const loadKeybindings = (
	env: NodeJS.ProcessEnv = process.env,
): ResolvedKeybindings => {
	const filePath = configFilePath(env);

	try {
		return resolveKeybindings(loadUserConfig(filePath).keybindings);
	} catch (error: unknown) {
		process.stderr.write(
			`${appName}: ignoring ${filePath}: ${(error as Error).message}\n`,
		);
		return defaultKeybindings;
	}
};
