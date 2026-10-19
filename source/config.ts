import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

/**
 * User configuration for gitminal.
 *
 * Loaded from `~/.config/gitminal/config.json` (or `$GITMINAL_CONFIG` when
 * set). Every field is optional: anything missing falls back to the defaults
 * baked into the app.
 */
export type UserConfig = {
	readonly keybindings: Readonly<Record<string, readonly string[]>>;
};

export const appName = 'gitminal';

export const emptyConfig: UserConfig = { keybindings: {} };

/** Resolve the config file location from the environment. */
export const configFilePath = (
	env: NodeJS.ProcessEnv = process.env,
): string => {
	const override = env['GITMINAL_CONFIG'];
	if (override !== undefined && override.length > 0) {
		return override;
	}

	const configHome = env['XDG_CONFIG_HOME'];
	const base =
		configHome !== undefined && configHome.length > 0
			? configHome
			: path.join(os.homedir(), '.config');

	return path.join(base, appName, 'config.json');
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const toStringList = (value: unknown): string[] | undefined => {
	if (typeof value === 'string') {
		return [value];
	}

	if (Array.isArray(value)) {
		const items: unknown[] = value;
		if (items.every((item): item is string => typeof item === 'string')) {
			return items;
		}
	}

	return undefined;
};

/**
 * Parse the raw config contents. Throws when the JSON is invalid so callers
 * can decide whether to warn and fall back to defaults.
 */
export const parseUserConfig = (raw: string): UserConfig => {
	const data: unknown = JSON.parse(raw);

	if (!isRecord(data)) {
		throw new Error('expected a JSON object at the top level');
	}

	const keybindingsRaw = data['keybindings'];
	if (keybindingsRaw === undefined) {
		return emptyConfig;
	}

	if (!isRecord(keybindingsRaw)) {
		throw new Error('"keybindings" must be an object');
	}

	const keybindings: Record<string, string[]> = {};
	for (const [action, value] of Object.entries(keybindingsRaw)) {
		const list = toStringList(value);
		if (list !== undefined) {
			keybindings[action] = list;
		}
	}

	return { keybindings };
};

/** Read and parse the user config, treating a missing file as empty config. */
export const loadUserConfig = (filePath = configFilePath()): UserConfig => {
	let raw: string;

	try {
		raw = fs.readFileSync(filePath, 'utf8');
	} catch (error: unknown) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return emptyConfig;
		}

		throw error;
	}

	return parseUserConfig(raw);
};
