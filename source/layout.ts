export type Layout = {
	columns: number;
	rows: number;
	chromeHeight: number;
	bodyHeight: number;
	sidebarWidth: number;
	commitsWidth: number;
	rightWidth: number;
};

const clamp = (value: number, min: number, max: number): number =>
	Math.max(min, Math.min(max, value));

export const getLayout = (columns: number, rows: number): Layout => {
	// Toolbar content and bottom border (2).
	const chromeHeight = 2;
	const sidebarWidth = clamp(Math.round(columns * 0.15), 16, 26);
	const commitsWidth = clamp(Math.round(columns * 0.3), 28, 46);
	const rightWidth = Math.max(24, columns - sidebarWidth - commitsWidth);

	return {
		columns,
		rows,
		chromeHeight,
		bodyHeight: Math.max(1, rows - chromeHeight),
		sidebarWidth,
		commitsWidth,
		rightWidth,
	};
};

export const padToWidth = (text: string, width: number): string => {
	if (width <= 0) {
		return '';
	}

	return text.length >= width
		? text.slice(0, width)
		: text + ' '.repeat(width - text.length);
};

export const truncate = (text: string, width: number): string =>
	text.length <= width
		? text
		: width <= 1
		? text.slice(0, width)
		: `${text.slice(0, width - 1)}`;

export const line = (glyph: string, width: number): string =>
	width <= 0 ? '' : glyph.repeat(width);
