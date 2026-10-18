import { resolveScheme } from './color-schemes.js';

const { theme, tagColors, graphColors } = resolveScheme();

export { theme, tagColors, graphColors };

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
 * Used to soften a palette color for chip backgrounds, which would otherwise
 * glare as a fully saturated fill.
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
