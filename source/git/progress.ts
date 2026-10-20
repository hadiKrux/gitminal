import type { Buffer } from 'node:buffer';
import { StringDecoder } from 'node:string_decoder';

/**
 * Live progress as git prints it to stderr during a remote transfer.
 *
 * `percent` survives a later phase line that has no percentage (for example
 * `Enumerating objects: 5, done.`), because the phase is still the useful
 * label and dropping the number would make the bar jump back to a spinner.
 */
export type ProgressState = {
	readonly phase: string | undefined;
	readonly percent: number | undefined;
	readonly done: number | undefined;
	readonly total: number | undefined;
};

/** A parser carries one command's stream; `reset` starts the next command. */
export type ProgressParser = {
	readonly state: ProgressState;
	/** Feed one raw stderr chunk and return the state it left behind. */
	push: (chunk: string | Buffer) => ProgressState;
	/** Drop the state, the partial line, and any half-decoded UTF-8 bytes. */
	reset: () => void;
	/** Process a trailing line that no newline terminated (end of command). */
	flush: () => ProgressState;
};

/**
 * Phases git prints for object transfer and local post-processing.
 *
 * The `remote: ` prefix appears on the receiving side: the server's own
 * progress is forwarded line by line, so the same phase can arrive prefixed
 * or plain depending on which side is doing the work.
 */
const phasePattern =
	/^\s*(?:remote:\s*)?(Enumerating objects|Counting objects|Compressing objects|Writing objects|Receiving objects|Resolving deltas|Updating files)\b/;

/**
 * `42% (21/50)` with any run of whitespace before the counts.
 *
 * Git updates a progress line in place with a carriage return, so the caller
 * must split on CR as well as LF; this pattern only ever sees one update.
 */
const percentPattern = /\b(\d{1,3})%\s+\((\d+)\/(\d+)\)/;

/** Lines are framed with any of the three newline spellings git emits. */
const lineBreakPattern = /\r\n|\r|\n/;

const emptyState = (): ProgressState => ({
	phase: undefined,
	percent: undefined,
	done: undefined,
	total: undefined,
});

/**
 * Create a stateful stderr progress parser.
 *
 * Chunks arrive at arbitrary byte boundaries, including in the middle of a
 * UTF-8 code point and in the middle of a progress line, so the parser keeps
 * both a decoder and a partial-line tail between calls. `StringDecoder` is
 * what makes a multi-byte phase name survive a split chunk; without it the
 * replacement characters would make the phase unmatchable.
 */
export const createProgressParser = (): ProgressParser => {
	let state = emptyState();
	let tail = '';
	let decoder = new StringDecoder('utf8');

	const consume = (line: string): void => {
		const phaseMatch = phasePattern.exec(line);
		const phase = phaseMatch?.[1];

		// Unrelated stderr (errors, hints, transport chatter) must not move
		// the bar; only a recognized phase line owns an update.
		if (phase === undefined) {
			return;
		}

		const percentMatch = percentPattern.exec(line);
		if (percentMatch === null) {
			// `Enumerating objects: 5, done.` has no percentage. Keep the last
			// one seen so the bar does not regress, but adopt the new phase.
			state = { ...state, phase };
			return;
		}

		const [, percentText = '0', doneText = '0', totalText = '0'] = percentMatch;
		state = {
			phase,
			// Clamp rather than trust the stream: git caps at 100, but a
			// malformed or future line must not push the bar past its width.
			percent: Math.max(0, Math.min(100, Number(percentText))),
			done: Number(doneText),
			total: Number(totalText),
		};
	};

	const push = (chunk: string | Buffer): ProgressState => {
		if (typeof chunk === 'string') {
			// A string chunk can follow a Buffer that ended mid-code-point;
			// drain the decoder first so the byte order is preserved.
			tail += decoder.end();
			decoder = new StringDecoder('utf8');
			tail += chunk;
		} else {
			tail += decoder.write(chunk);
		}

		const lines = tail.split(lineBreakPattern);
		// The last segment is either an incomplete line or the empty string
		// after a trailing newline; either way it is not complete yet.
		tail = lines.pop() ?? '';
		for (const line of lines) {
			consume(line);
		}

		return state;
	};

	const reset = (): void => {
		state = emptyState();
		tail = '';
		decoder = new StringDecoder('utf8');
	};

	const flush = (): ProgressState => {
		// A command can end without a newline (a final CR update is common).
		tail += decoder.end();
		decoder = new StringDecoder('utf8');

		const remaining = tail;
		tail = '';
		if (remaining.length > 0) {
			consume(remaining);
		}

		return state;
	};

	return {
		get state() {
			return state;
		},
		push,
		reset,
		flush,
	};
};
