import { resolveScheme } from './color-schemes.js';

const { theme, tagColors, graphColors } = resolveScheme();

export { theme, tagColors, graphColors };

export const colorAt = (palette: readonly string[], index: number): string =>
	palette[index % palette.length] ?? palette[0] ?? '#ffffff';

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
