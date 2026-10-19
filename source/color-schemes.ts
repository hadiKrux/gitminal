import process from 'node:process';

/**
 * Color schemes for gitminal.
 *
 * A scheme maps the app's semantic tokens onto a concrete palette. To add a
 * new scheme, define it below and register it in `schemes` (and, if it should
 * be the default for a variant, point `defaultSchemes` at it). Components only
 * ever read the semantic tokens, so no component has to change.
 */

export type Variant = 'dark' | 'light';

export type ThemeTokens = {
	bg: string;
	bgAlt: string;
	bgPanel: string;
	border: string;
	text: string;
	dim: string;
	dimmer: string;
	accent: string;
	accentBg: string;
	tabActiveBg: string;
	tabInactiveFg: string;
	labelFg: string;
	fileCount: string;
	add: string;
	del: string;
	success: string;
	warn: string;
	codeBg: string;
	codeText: string;
	codeGutterFg: string;
	addBg: string;
	addText: string;
	delBg: string;
	delText: string;
};

/**
 * Colors for the syntax highlighter, keyed by semantic token rather than by the
 * highlighter's own names so a scheme stays the only place that picks colors.
 */
export type SyntaxColors = {
	readonly default: string;
	readonly keyword: string;
	readonly builtIn: string;
	readonly type: string;
	readonly literal: string;
	readonly number: string;
	readonly regexp: string;
	readonly string: string;
	readonly comment: string;
	readonly function: string;
	readonly className: string;
	readonly tag: string;
	readonly attr: string;
	readonly meta: string;
	readonly variable: string;
	readonly symbol: string;
	readonly section: string;
	readonly addition: string;
	readonly deletion: string;
};

export type ColorScheme = {
	readonly variant: Variant;
	readonly theme: ThemeTokens;
	readonly syntax: SyntaxColors;
	readonly tagColors: readonly string[];
	readonly graphColors: readonly string[];
};

export const mocha: ColorScheme = {
	variant: 'dark',
	theme: {
		bg: '#1e1e2e', // Base
		bgAlt: '#181825', // Mantle
		bgPanel: '#313244', // Surface0
		border: '#11111b', // Crust
		text: '#cdd6f4', // Text
		dim: '#a6adc8', // Subtext0
		dimmer: '#6c7086', // Overlay0
		accent: '#89b4fa', // Blue
		accentBg: '#45475a', // Surface1
		tabActiveBg: '#313244', // Surface0
		tabInactiveFg: '#7f849c', // Overlay1
		labelFg: '#bac2de', // Subtext1
		fileCount: '#fab387', // Peach
		add: '#a6e3a1', // Green
		del: '#f38ba8', // Red
		success: '#a6e3a1', // Green
		warn: '#f9e2af', // Yellow
		codeBg: '#181825', // Mantle
		codeText: '#cdd6f4', // Text
		codeGutterFg: '#6c7086', // Overlay0
		addBg: '#a6e3a1', // Green
		addText: '#1e1e2e', // Base
		delBg: '#f38ba8', // Red
		delText: '#1e1e2e', // Base
	},
	syntax: {
		default: '#cdd6f4', // Text
		keyword: '#cba6f7', // Mauve
		builtIn: '#74c7ec', // Sapphire
		type: '#f9e2af', // Yellow
		literal: '#fab387', // Peach
		number: '#fab387', // Peach
		regexp: '#f5c2e7', // Pink
		string: '#a6e3a1', // Green
		comment: '#6c7086', // Overlay0
		function: '#89b4fa', // Blue
		className: '#f9e2af', // Yellow
		tag: '#f38ba8', // Red
		attr: '#f9e2af', // Yellow
		meta: '#fab387', // Peach
		variable: '#f5c2e7', // Pink
		symbol: '#fab387', // Peach
		section: '#89b4fa', // Blue
		addition: '#a6e3a1', // Green
		deletion: '#f38ba8', // Red
	},
	tagColors: [
		'#89b4fa', // Blue
		'#fab387', // Peach
		'#a6e3a1', // Green
		'#cba6f7', // Mauve
		'#f9e2af', // Yellow
		'#74c7ec', // Sapphire
	],
	graphColors: [
		'#89b4fa', // Blue
		'#fab387', // Peach
		'#a6e3a1', // Green
		'#cba6f7', // Mauve
		'#f9e2af', // Yellow
	],
};

export const latte: ColorScheme = {
	variant: 'light',
	theme: {
		bg: '#eff1f5', // Base
		bgAlt: '#e6e9ef', // Mantle
		bgPanel: '#ccd0da', // Surface0
		border: '#dce0e8', // Crust
		text: '#4c4f69', // Text
		dim: '#6c6f85', // Subtext0
		dimmer: '#9ca0b0', // Overlay0
		accent: '#1e66f5', // Blue
		accentBg: '#bcc0cc', // Surface1
		tabActiveBg: '#ccd0da', // Surface0
		tabInactiveFg: '#8c8fa1', // Overlay1
		labelFg: '#5c5f77', // Subtext1
		fileCount: '#fe640b', // Peach
		add: '#40a02b', // Green
		del: '#d20f39', // Red
		success: '#40a02b', // Green
		warn: '#df8e1d', // Yellow
		codeBg: '#e6e9ef', // Mantle
		codeText: '#4c4f69', // Text
		codeGutterFg: '#9ca0b0', // Overlay0
		addBg: '#40a02b', // Green
		addText: '#eff1f5', // Base
		delBg: '#d20f39', // Red
		delText: '#eff1f5', // Base
	},
	syntax: {
		default: '#4c4f69', // Text
		keyword: '#8839ef', // Mauve
		builtIn: '#209fb5', // Sapphire
		type: '#df8e1d', // Yellow
		literal: '#fe640b', // Peach
		number: '#fe640b', // Peach
		regexp: '#ea76cb', // Pink
		string: '#40a02b', // Green
		comment: '#9ca0b0', // Overlay0
		function: '#1e66f5', // Blue
		className: '#df8e1d', // Yellow
		tag: '#d20f39', // Red
		attr: '#df8e1d', // Yellow
		meta: '#fe640b', // Peach
		variable: '#ea76cb', // Pink
		symbol: '#fe640b', // Peach
		section: '#1e66f5', // Blue
		addition: '#40a02b', // Green
		deletion: '#d20f39', // Red
	},
	tagColors: [
		'#1e66f5', // Blue
		'#fe640b', // Peach
		'#40a02b', // Green
		'#8839ef', // Mauve
		'#df8e1d', // Yellow
		'#209fb5', // Sapphire
	],
	graphColors: [
		'#1e66f5', // Blue
		'#fe640b', // Peach
		'#40a02b', // Green
		'#8839ef', // Mauve
		'#df8e1d', // Yellow
	],
};

/** Registry of every available scheme, keyed by the name used in `GITMINAL_THEME`. */
export const schemes: Readonly<Record<string, ColorScheme>> = { mocha, latte };

/** Scheme used for each terminal variant when nothing else is specified. */
export const defaultSchemes: Readonly<Record<Variant, string>> = {
	dark: 'mocha',
	light: 'latte',
};

const fallbackScheme = mocha;

/**
 * Best-effort detection of the terminal's background variant. Terminals expose
 * this inconsistently, so we look at the common hints and default to dark.
 */
export function detectVariant(env: NodeJS.ProcessEnv = process.env): Variant {
	const termBackground = env['TERM_BACKGROUND']?.toLowerCase();
	if (termBackground === 'dark' || termBackground === 'light') {
		return termBackground;
	}

	const colorFgBg = env['COLORFGBG'];
	if (colorFgBg !== undefined) {
		const segments = colorFgBg.split(';');
		const background = Number.parseInt(segments[segments.length - 1] ?? '', 10);
		if (!Number.isNaN(background)) {
			// 0-6 are the dark base colors, 7 is white, 8 is bright black and
			// 9-15 are the bright colors (15 being bright white).
			return background === 7 || background >= 9 ? 'light' : 'dark';
		}
	}

	return 'dark';
}

/** Resolve the active scheme name from the environment. */
export function resolveSchemeName(
	env: NodeJS.ProcessEnv = process.env,
): string {
	const requested = env['GITMINAL_THEME'];
	if (requested !== undefined && requested in schemes) {
		return requested;
	}

	return defaultSchemes[detectVariant(env)];
}

/** Resolve the active scheme from the environment. */
export function resolveScheme(
	env: NodeJS.ProcessEnv = process.env,
): ColorScheme {
	const name = resolveSchemeName(env);
	return schemes[name] ?? fallbackScheme;
}
