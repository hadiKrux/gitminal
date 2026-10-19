import stringWidth from 'string-width';

export type Layout = {
	columns: number;
	rows: number;
	chromeHeight: number;
	bodyHeight: number;
	/** Rows reserved below the body for the operation console; 0 while closed. */
	consoleHeight: number;
	sidebarWidth: number;
	commitsWidth: number;
	rightWidth: number;
};

export type LayoutOptions = {
	/** The console is non-modal but still takes flow space when shown. */
	readonly isConsoleOpen?: boolean;
};

const clamp = (value: number, min: number, max: number): number =>
	Math.max(min, Math.min(max, value));

export const getLayout = (
	columns: number,
	rows: number,
	options: LayoutOptions = {},
): Layout => {
	// A third of the screen keeps the log readable without starving the work
	// area; the floor keeps enough rows for a few entries and the cap keeps a
	// tall terminal from turning the console into the main view. On a terminal
	// too short for toolbar plus body plus a usable console, the console gives
	// up its rows (and disappears below two) instead of overflowing the screen.
	const desiredConsoleHeight =
		options.isConsoleOpen === true ? clamp(Math.round(rows * 0.35), 5, 12) : 0;
	const cappedConsoleHeight = Math.min(
		desiredConsoleHeight,
		Math.max(0, rows - 3),
	);
	const consoleHeight = cappedConsoleHeight < 2 ? 0 : cappedConsoleHeight;
	// Toolbar content row (it now carries the status) and its bottom border (2).
	const chromeHeight = 2 + consoleHeight;
	let sidebarWidth = clamp(Math.round(columns * 0.15), 16, 26);
	let commitsWidth = clamp(Math.round(columns * 0.3), 28, 46);
	// On narrow terminals the explorer and sidebar give up width first, so the
	// right panel keeps its minimum and nothing is pushed off screen.
	commitsWidth = Math.max(
		20,
		Math.min(commitsWidth, columns - sidebarWidth - 24),
	);
	sidebarWidth = Math.max(
		12,
		Math.min(sidebarWidth, columns - commitsWidth - 24),
	);
	const rightWidth = Math.max(24, columns - sidebarWidth - commitsWidth);

	return {
		columns,
		rows,
		chromeHeight,
		bodyHeight: Math.max(1, rows - chromeHeight),
		consoleHeight,
		sidebarWidth,
		commitsWidth,
		rightWidth,
	};
};

const graphemes: Intl.Segmenter = new Intl.Segmenter(undefined, {
	granularity: 'grapheme',
});

/** Terminal cell width of `text`, where wide and emoji characters count as two. */
export const textWidth = (text: string): number => stringWidth(text);

export const padToWidth = (text: string, width: number): string => {
	if (width <= 0) {
		return '';
	}

	const cut = truncate(text, width);
	return cut + ' '.repeat(Math.max(0, width - textWidth(cut)));
};

/**
 * Cut `text` to at most `width` terminal cells. Cuts fall on grapheme
 * boundaries so an emoji or combined character is never split in half.
 */
export const truncate = (text: string, width: number): string => {
	if (width <= 0) {
		return '';
	}

	if (textWidth(text) <= width) {
		return text;
	}

	let result = '';
	let used = 0;
	for (const { segment } of graphemes.segment(text)) {
		const segmentWidth = textWidth(segment);
		if (used + segmentWidth > width) {
			break;
		}

		result += segment;
		used += segmentWidth;
	}

	return result;
};

export const line = (glyph: string, width: number): string =>
	width <= 0 ? '' : glyph.repeat(width);
