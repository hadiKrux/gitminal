import chalk from 'chalk';
import { resolveScheme, type ThemeTokens } from './color-schemes.js';

const { theme: baseTheme, syntax, tagColors, graphColors } = resolveScheme();

export { tagColors, graphColors };

export const colorAt = (palette: readonly string[], index: number): string =>
	palette[index % palette.length] ?? palette[0] ?? '#ffffff';

const channels = (hex: string): [number, number, number] => {
	const value = hex.replace('#', '');
	return [
		Number.parseInt(value.slice(0, 2), 16),
		Number.parseInt(value.slice(2, 4), 16),
		Number.parseInt(value.slice(4, 6), 16),
	];
};

const channel = (value: number): string =>
	Math.round(value).toString(16).padStart(2, '0');

/**
 * Blend `amount` of `color` into `base` (0 keeps `base`, 1 keeps `color`).
 *
 * Used to soften a palette color for a background fill, which would otherwise
 * glare at full saturation.
 */
export const tint = (color: string, base: string, amount: number): string => {
	const [red, green, blue] = channels(color);
	const [baseRed, baseGreen, baseBlue] = channels(base);
	const blend = (from: number, to: number): number =>
		from * amount + to * (1 - amount);
	return `#${channel(blend(red, baseRed))}${channel(
		blend(green, baseGreen),
	)}${channel(blend(blue, baseBlue))}`;
};

export const asciiBorder = {
	topLeft: '+',
	top: '-',
	topRight: '+',
	left: '|',
	right: '|',
	bottomLeft: '+',
	bottom: '-',
	bottomRight: '+',
} as const;

/**
 * The app theme plus the tokens the diff view derives from it.
 *
 * The add/delete backgrounds are not scheme colors of their own: they are the
 * scheme's green and red softened into the base background, so a full-width
 * change block reads clearly without glaring. Deriving them here keeps every
 * scheme from having to hand-tune two more hex values.
 */
export type AppTheme = ThemeTokens & {
	readonly diffAddBg: string;
	readonly diffDelBg: string;
};

export const theme: AppTheme = {
	...baseTheme,
	diffAddBg: tint(baseTheme.add, baseTheme.bg, 0.2),
	diffDelBg: tint(baseTheme.del, baseTheme.bg, 0.22),
};

/**
 * A cli-highlight theme: each token maps to a formatter that wraps the matched
 * code in ANSI color codes. Built once from the scheme so highlighting matches
 * the rest of the UI.
 *
 * The pairs are a table rather than an object literal because the highlighter's
 * token names (`built_in`, `meta-keyword`, ...) are not our naming convention.
 */
export type SyntaxTheme = Record<string, (code: string) => string>;

const syntaxTokens: ReadonlyArray<readonly [string, string]> = [
	['default', syntax.default],
	['keyword', syntax.keyword],
	['built_in', syntax.builtIn],
	['type', syntax.type],
	['literal', syntax.literal],
	['number', syntax.number],
	['regexp', syntax.regexp],
	['string', syntax.string],
	['subst', syntax.string],
	['comment', syntax.comment],
	['doctag', syntax.comment],
	['function', syntax.function],
	['title', syntax.function],
	['class', syntax.className],
	['tag', syntax.tag],
	['name', syntax.tag],
	['attr', syntax.attr],
	['attribute', syntax.attr],
	['meta', syntax.meta],
	['meta-keyword', syntax.keyword],
	['meta-string', syntax.string],
	['variable', syntax.variable],
	['template-variable', syntax.variable],
	['symbol', syntax.symbol],
	['section', syntax.section],
	['addition', syntax.addition],
	['deletion', syntax.deletion],
];

export const syntaxTheme: SyntaxTheme = Object.fromEntries(
	syntaxTokens.map(([token, color]) => [token, chalk.hex(color)] as const),
);
