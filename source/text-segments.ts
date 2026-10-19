/**
 * Grapheme boundaries shared by the text inputs.
 *
 * A cursor is a UTF-16 offset, so moving or deleting by one "character" must
 * land on a grapheme boundary rather than split an emoji, an accent, or a wide
 * character. Both inputs use this one segmenter so their editing behaviour
 * cannot drift apart.
 */

/** Grapheme boundaries, so wide characters and emoji are never split. */
export const segmenter = new Intl.Segmenter(undefined, {
	granularity: 'grapheme',
});

/** Greatest grapheme boundary at or before `cursor`. */
export const previousBoundary = (text: string, cursor: number): number => {
	let previous = 0;
	for (const { index } of segmenter.segment(text)) {
		if (index >= cursor) {
			break;
		}

		previous = index;
	}

	return previous;
};

/** Smallest grapheme boundary after `cursor`. */
export const nextBoundary = (text: string, cursor: number): number => {
	for (const { index } of segmenter.segment(text)) {
		if (index > cursor) {
			return index;
		}
	}

	return text.length;
};
