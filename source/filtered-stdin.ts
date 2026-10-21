import { PassThrough } from 'node:stream';
import process from 'node:process';
import { stripMouseReports } from './mouse-reports.js';

/**
 * Rewrite the Backspace key's byte to the one Ink maps to `key.backspace`.
 *
 * Terminals send DEL (`\u007F`) for the Backspace key, but Ink reports both
 * DEL and the real Delete key (`\u001B[3~`) as `key.delete`, reserving
 * `key.backspace` for Ctrl+H (`\b`). An editing component that trusts the
 * flags therefore sees Backspace as a forward delete, which erases nothing at
 * the end of a line. Rewriting the byte before Ink parses it makes the flags
 * mean what the keys mean: Backspace deletes backward, Delete still deletes
 * forward. Both byte forms are accepted, since terminals are configurable.
 */
export const normalizeBackspace = (input: string): string =>
	input.replaceAll('\u007F', '\b');

/**
 * Ink's input stream with terminal mouse reports removed and keys normalized.
 *
 * The mouse layer reads xterm mouse reports straight from `process.stdin`, but
 * Ink also delivers the same bytes to every `useInput` listener, where a text
 * field inserts them as if they were typed. Filtering at the stream boundary
 * keeps editing components usable with an off-the-shelf input; the mouse layer
 * still sees the unfiltered stream and keeps driving hover, click, and wheel.
 */
export const createFilteredStdin = (
	source: NodeJS.ReadStream = process.stdin,
): NodeJS.ReadStream => {
	const input = new PassThrough() as PassThrough & {
		isTTY?: boolean;
		setRawMode: (value: boolean) => PassThrough;
		ref: () => PassThrough;
		unref: () => PassThrough;
	};

	input.isTTY = source.isTTY;
	input.setRawMode = value => {
		source.setRawMode?.(value);

		return input;
	};

	input.ref = () => {
		source.ref();

		return input;
	};

	input.unref = () => {
		source.unref();

		return input;
	};

	source.setEncoding('utf8');

	source.on('data', chunk => {
		const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
		const filtered = normalizeBackspace(stripMouseReports(text));
		if (filtered.length > 0) {
			input.write(filtered);
		}
	});

	return input as unknown as NodeJS.ReadStream;
};
