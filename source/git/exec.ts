import {
	spawn,
	spawnSync,
	type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import { Buffer } from 'node:buffer';
import process from 'node:process';

/** Shared cap for accumulated stdout/stderr. */
const maxOutputBytes = 10 * 1024 * 1024;

/**
 * How long a local mutation may run before its process group is killed.
 *
 * Local git work is fast, so a mutation that runs this long is stuck on
 * something external (a hook waiting on a lock, an fs that never returns).
 * The timeout exists so the queue can never stay busy forever; remote
 * operations keep their own, shorter limit (`remoteTimeoutMs` in remote.ts).
 * It applies per git command, not per operation: a chunked bulk stage runs
 * one command per chunk, each with its own window.
 */
export const operationTimeoutMs = 60_000;

/**
 * How long a read-only command may run before its process group is killed.
 *
 * Reads feed the single refresh slot, so a status, log, refs, or diff command
 * stuck on a lock or a network filesystem must not hold that slot forever. The
 * limit is deliberately generous: a large `git log` on a slow disk is real
 * work, not a hang, and a killed read only costs a failed refresh.
 */
export const readOnlyTimeoutMs = 120_000;

/**
 * How long a timed-out command may keep its pipes open after the kill.
 *
 * A transport child that survived the direct kill can hold stdout/stderr and
 * delay the child's `close` indefinitely. The timeout must still free the
 * queue, so after this deadline the streams are destroyed and the command is
 * rejected with the timeout error even without a `close` event.
 */
const timeoutKillSettleMs = 1000;

/**
 * Error captures keep this many lines in total (first half plus last half).
 *
 * A failing git command can produce more output than a person can read, and
 * the error overlay scrolls a bounded viewport. Keeping both ends preserves
 * the command context at the top and the decisive `fatal:` line at the
 * bottom, which is where the actionable message almost always is.
 */
const errorLineCap = 400;
const errorLinesPerSide = errorLineCap / 2;
const errorByteCap = 64 * 1024;

/**
 * True for a UTF-8 continuation byte, i.e. the middle of a character.
 *
 * A comparison rather than a mask because the project's lint forbids bitwise
 * operators; continuation bytes are exactly `0x80` through `0xbf`.
 */
const isContinuation = (byte: number): boolean => byte >= 0x80 && byte <= 0xbf;

/**
 * Move a byte cut point back to the first byte of the character it splits.
 *
 * `end` is the exclusive end of the prefix. Slicing there can land inside a
 * multibyte character, which decodes as a replacement character that then
 * re-encodes wider than the bytes it replaced and pushes the copy past the
 * cap. Stepping back to the lead byte keeps the byte bound exact.
 */
const alignHeadEnd = (bytes: Buffer, end: number): number => {
	if (end <= 0 || end >= bytes.length) {
		return end;
	}

	// The cut already sits after a complete character.
	if (!isContinuation(bytes[end - 1] ?? 0)) {
		return end;
	}

	// Drop the character whose lead byte the cut would strip.
	let index = end - 1;
	while (index > 0 && isContinuation(bytes[index] ?? 0)) {
		index -= 1;
	}

	return index;
};

/**
 * Move a byte cut point forward to the first byte of the next character.
 *
 * `start` is the inclusive start of the suffix; landing on a continuation
 * byte would lose that character's lead byte and decode as a replacement
 * character, so the suffix begins at the next character boundary instead.
 */
const alignTailStart = (bytes: Buffer, start: number): number => {
	let index = Math.max(start, 0);
	while (index < bytes.length && isContinuation(bytes[index] ?? 0)) {
		index += 1;
	}

	return index;
};

/**
 * Keep a bounded prefix and suffix of `text` around `marker`.
 *
 * The line-oriented path keeps whole lines, so a capture whose first and last
 * lines are both larger than a side's byte budget keeps no line at all and
 * would reduce an enormous single-line capture to the marker alone. Slicing
 * the raw text by bytes instead still shows the start and the end, which is
 * what makes the failure recognizable, while the cap bounds storage. Both
 * slices together plus the marker stay within `errorByteCap`.
 *
 * The cuts are aligned to character boundaries on a best-effort basis: a
 * character split by the budget is dropped rather than decoded as a
 * replacement character, which keeps the stored copy inside the cap.
 */
const boundedSides = (text: string, marker: string): string => {
	const bytes = Buffer.from(text, 'utf8');
	// The two newlines around the marker are part of the stored copy too.
	const available = errorByteCap - Buffer.byteLength(marker, 'utf8') - 2;
	const sideBudget = Math.floor(available / 2);

	if (sideBudget <= 0) {
		return marker;
	}

	const headEnd = alignHeadEnd(bytes, Math.min(sideBudget, bytes.length));
	// Never overlap the prefix when the text is shorter than twice the budget.
	const tailStart = alignTailStart(
		bytes,
		Math.max(bytes.length - sideBudget, headEnd),
	);
	const head = bytes.subarray(0, headEnd).toString('utf8');
	const tail = bytes.subarray(tailStart).toString('utf8');

	return `${head}\n${marker}\n${tail}`;
};

/**
 * Cap captured output stored on a `GitError`.
 *
 * Successful results keep their full stdout/stderr because parsers read them.
 * Only the error copy is bounded: the first and last lines survive, and an
 * explicit marker names how many lines were dropped. A single enormous line
 * (a binary blob printed by accident) is bounded by bytes instead, with the
 * same marker, so storage stays proportional to what can be displayed. When
 * either side keeps no whole line, a byte-bounded prefix and suffix of the raw
 * text survives instead of dropping that side.
 */
export const capStoredOutput = (text: string): string => {
	if (text.length === 0) {
		return text;
	}

	const lines = text.split('\n');

	if (
		lines.length <= errorLineCap &&
		Buffer.byteLength(text, 'utf8') <= errorByteCap
	) {
		return text;
	}

	const headBudget = errorByteCap / 2;
	const tailBudget = errorByteCap / 2;
	// Split the line budget rather than letting both sides claim 200 lines:
	// on a capture shorter than the cap that would count overlapping lines
	// twice and defeat the byte bound.
	const headLimit = Math.min(errorLinesPerSide, Math.ceil(lines.length / 2));
	const tailLimit = Math.min(errorLinesPerSide, Math.floor(lines.length / 2));
	const head: string[] = [];
	const tail: string[] = [];
	let headBytes = 0;
	let tailBytes = 0;

	for (let index = 0; index < headLimit; index += 1) {
		const line = lines[index] ?? '';
		const bytes = Buffer.byteLength(line, 'utf8') + 1;

		if (headBytes + bytes > headBudget) {
			break;
		}

		head.push(line);
		headBytes += bytes;
	}

	for (
		let index = lines.length - 1;
		index >= 0 && tail.length < tailLimit;
		index -= 1
	) {
		const line = lines[index] ?? '';
		const bytes = Buffer.byteLength(line, 'utf8') + 1;

		if (tailBytes + bytes > tailBudget) {
			break;
		}

		tail.unshift(line);
		tailBytes += bytes;
	}

	const kept = head.length + tail.length;
	const omitted = lines.length - kept;

	if (omitted <= 0) {
		return text;
	}

	const marker = `... ${omitted} line${omitted === 1 ? '' : 's'} omitted ...`;

	// A side can end up empty even when the other one kept lines: the line at
	// that edge exceeded its byte budget, so the loop stopped before taking
	// anything. Returning the surviving side alone would lose the decisive
	// tail (or the command context), so both ends come from the byte-bounded
	// fallback instead.
	if (head.length === 0 || tail.length === 0) {
		return boundedSides(text, marker);
	}

	return [...head, marker, ...tail].join('\n');
};

/** The bounded copy a `GitError` stores; argv and exit code stay unchanged. */
const cappedDetails = (details: GitErrorDetails): GitErrorDetails => ({
	...details,
	stdout: capStoredOutput(details.stdout),
	stderr: capStoredOutput(details.stderr),
});

/**
 * Prefix of the marker appended when a capture hits the cap.
 *
 * Exported so a line-oriented parser can recognize the marker instead of
 * treating it as data; the full marker adds only the cap to this text.
 */
export const truncationMarkerPrefix = '[... output truncated';

const truncationMarker = `\n${truncationMarkerPrefix} at ${maxOutputBytes} bytes ...]`;

/**
 * Environment every spawned git process gets, no matter the caller.
 *
 * This code runs underneath a TUI: git must never wait for a credential, edit a
 * message in $EDITOR, or open a pager, because none of those can reach the
 * screen and the terminal would simply hang. ssh gets BatchMode so passphrase
 * and host-key prompts fail fast instead of stalling the app.
 *
 * Written as pairs first because the variable names are environment keys, not
 * camel-case properties, and the linter rightly rejects the literal form.
 *
 * Literal pathspecs are deliberately not an environment variable here. The
 * policy belongs to gitminal's own argv (`globalFlags`): an exported
 * `GIT_LITERAL_PATHSPECS` would also reach hooks, aliases, and helpers git
 * spawns, where a user's own script expects normal glob pathspecs.
 */
const gitEnvPolicy: Readonly<Record<string, string>> = Object.fromEntries([
	['GIT_TERMINAL_PROMPT', '0'],
	['GIT_EDITOR', 'true'],
	['GIT_MERGE_AUTOEDIT', '0'],
	['GIT_PAGER', 'cat'],
	['GIT_SSH_COMMAND', 'ssh -o BatchMode=yes'],
]);

export type RunGitOptions = {
	/** Directory the command runs in; repository commands use the repo root. */
	readonly cwd: string;
	/** Exit codes that resolve instead of throwing; defaults to `[0]`. */
	readonly allowExitCodes?: readonly number[];
	/** Kill the whole process group after this many milliseconds. */
	readonly timeoutMs?: number;
	/** Written to stdin before it is closed. */
	readonly input?: string | Buffer;
	/** Receives raw stderr chunks as git emits them (progress parsing). */
	readonly onStderrChunk?: (chunk: Buffer) => void;
	/**
	 * Whether this command passes path arguments that must be treated
	 * literally. Defaults to false, and only commands that pass paths should
	 * opt in: the flag is exported to hooks, aliases, and helpers, so a
	 * command with no pathspec must not set it.
	 */
	readonly literalPathspecs?: boolean;
	/** Adds the read-only global flags; use `runGitReadOnly` instead. */
	readonly readOnly?: boolean;
};

export type GitResult = {
	/** The full argv, global flags included, for logs and the console. */
	readonly args: readonly string[];
	readonly exitCode: number;
	readonly stdout: string;
	/**
	 * Raw stdout bytes, without the truncation marker. Byte-exact consumers
	 * (porcelain `-z` parsing, where paths are NUL-separated and may not be
	 * UTF-8) must read this instead of the decoded `stdout`.
	 */
	readonly stdoutBytes: Buffer;
	readonly stderr: string;
};

export type GitErrorDetails = {
	readonly args: readonly string[];
	/** Undefined when git was killed by a timeout or a signal before exiting. */
	readonly exitCode: number | undefined;
	readonly stdout: string;
	readonly stderr: string;
};

/** Raised when git exits with a code the caller did not allow. */
export class GitError extends Error {
	readonly args: readonly string[];
	readonly exitCode: number | undefined;
	readonly stdout: string;
	readonly stderr: string;
	/** True when the timeout killed the process group instead of git exiting. */
	readonly timedOut: boolean;

	constructor(details: GitErrorDetails, message: string, timedOut = false) {
		super(message);
		this.name = 'GitError';
		this.args = details.args;
		this.exitCode = details.exitCode;
		this.stdout = details.stdout;
		this.stderr = details.stderr;
		this.timedOut = timedOut;
	}
}

/** Raised when the git binary itself cannot be spawned. */
export class GitNotFoundError extends Error {
	constructor(message = 'git was not found on PATH') {
		super(message);
		this.name = 'GitNotFoundError';
	}
}

type Accumulator = {
	readonly chunks: Buffer[];
	length: number;
	truncated: boolean;
};

const appendChunk = (accumulator: Accumulator, chunk: Buffer): void => {
	const remaining = maxOutputBytes - accumulator.length;

	if (remaining <= 0) {
		accumulator.truncated = true;
		return;
	}

	if (chunk.length > remaining) {
		// Slice the overshoot so the cap is hard, not one chunk soft.
		accumulator.chunks.push(chunk.subarray(0, remaining));
		accumulator.length = maxOutputBytes;
		accumulator.truncated = true;
		return;
	}

	accumulator.chunks.push(chunk);
	accumulator.length += chunk.length;
};

const accumulatedBytes = (accumulator: Accumulator): Buffer =>
	Buffer.concat(accumulator.chunks);

const textOf = (accumulator: Accumulator, bytes: Buffer): string => {
	const text = bytes.toString('utf8');
	return accumulator.truncated ? `${text}${truncationMarker}` : text;
};

const accumulatedText = (accumulator: Accumulator): string =>
	textOf(accumulator, accumulatedBytes(accumulator));

/**
 * Global flags placed before the subcommand.
 *
 * `--no-pager` keeps git from spawning a pager over the TUI. `-c
 * color.ui=false` forces plain output for every command, mutations included:
 * the status line and the error overlay show captured stderr, and a user's
 * `color.ui=always` must not put escape sequences in them. Read-only commands
 * additionally skip the optional index locks (`status` often runs while the
 * user's own terminal has git open).
 *
 * `--literal-pathspecs` treats every path argument literally. Status paths are
 * data, not patterns: a tracked file named `a*`, `?.txt`, or `:(exclude)foo`
 * must name itself after `--` instead of matching unrelated paths, or one
 * action on a single row could touch the whole repository. The flag is argv
 * rather than an environment variable on purpose: gitminal's hooks and helpers
 * inherit the environment, so only commands that actually pass paths opt in.
 * Everything else gets the explicit inverse, which also neutralizes a
 * `GIT_LITERAL_PATHSPECS` the user's shell exported.
 */
const globalFlags = (
	readOnly: boolean | undefined,
	literalPathspecs: boolean | undefined,
): string[] => {
	const flags = [
		'--no-pager',
		'-c',
		'color.ui=false',
		literalPathspecs === true
			? '--literal-pathspecs'
			: '--no-literal-pathspecs',
	];

	if (readOnly === true) {
		flags.push('--no-optional-locks');
	}

	return flags;
};

/**
 * Live git children keyed by process group id, for shutdown cleanup.
 *
 * The timeout path already knows its child; this map is what lets the app kill
 * every git command that is still running when the process is about to exit.
 * Entries are removed as soon as the child settles, so a long session does not
 * accumulate dead pids.
 */
const activeChildren = new Map<number, ChildProcessWithoutNullStreams>();

/**
 * Kill git and everything it spawned.
 *
 * Spawned detached, git leads its own process group, so signalling the group
 * reaches transport children (ssh, git-remote-https) that would otherwise keep
 * the output pipes open and the promise unresolved. A group signal is POSIX
 * only. Windows has no negative-pid group signal, so `taskkill /T /F` asks the
 * OS to terminate the whole tree before falling back to the direct child.
 */
const killProcessGroup = (child: ChildProcessWithoutNullStreams): void => {
	if (child.pid === undefined) {
		return;
	}

	if (process.platform === 'win32') {
		try {
			const result = spawnSync(
				'taskkill',
				['/pid', String(child.pid), '/T', '/F'],
				{ stdio: 'ignore', windowsHide: true },
			);

			if (result.status === 0) {
				return;
			}
		} catch {
			// Taskkill is unavailable; fall through to the direct child kill.
		}
	}

	try {
		process.kill(-child.pid, 'SIGKILL');
		return;
	} catch {
		// Windows has no negative-pid group signal; fall through to the child.
	}

	try {
		child.kill('SIGKILL');
	} catch {
		// Already gone; the caller is cleaning up, not reporting a failure.
	}
};

/**
 * Kill every git command still running, synchronously.
 *
 * Registered for normal process exit. POSIX gets a group kill so transport
 * children cannot outlive gitminal; Windows asks `taskkill /T /F` to terminate
 * the tree and falls back to the direct process. The set is cleared even if a
 * kill fails, because the process is exiting and a stale pid must not be
 * signalled twice.
 */
export const killActiveGitChildren = (): void => {
	for (const child of activeChildren.values()) {
		killProcessGroup(child);
	}

	activeChildren.clear();
};

/**
 * Run `git` and capture its output.
 *
 * Built on `spawn` (not `execFile`) because stderr must be streamable for the
 * progress parser and the process must be killable as a group on timeout.
 */
export const runGit = async (
	args: readonly string[],
	options: RunGitOptions,
): Promise<GitResult> => {
	const argv = [
		...globalFlags(options.readOnly, options.literalPathspecs),
		...args,
	];
	const allowExitCodes = options.allowExitCodes ?? [0];

	return new Promise<GitResult>((resolve, reject) => {
		const child = spawn('git', argv, {
			cwd: options.cwd,
			env: { ...process.env, ...gitEnvPolicy },
			stdio: ['pipe', 'pipe', 'pipe'],
			detached: true,
		});
		const groupId = child.pid;

		if (groupId !== undefined) {
			activeChildren.set(groupId, child);
		}

		const stdout: Accumulator = { chunks: [], length: 0, truncated: false };
		const stderr: Accumulator = { chunks: [], length: 0, truncated: false };
		let timedOut = false;
		let settled = false;
		let timer: NodeJS.Timeout | undefined;
		let forceSettleTimer: NodeJS.Timeout | undefined;

		const stopTimer = (): void => {
			if (timer !== undefined) {
				clearTimeout(timer);
				timer = undefined;
			}

			if (forceSettleTimer !== undefined) {
				clearTimeout(forceSettleTimer);
				forceSettleTimer = undefined;
			}
		};

		/** The one error both the close path and the force-settle path report. */
		const timeoutError = (): GitError => {
			const stdoutBytes = accumulatedBytes(stdout);

			return new GitError(
				cappedDetails({
					args: argv,
					exitCode: undefined,
					stdout: textOf(stdout, stdoutBytes),
					stderr: accumulatedText(stderr),
				}),
				`git ${argv.join(' ')} timed out after ${options.timeoutMs ?? 0} ms`,
				true,
			);
		};

		/**
		 * Exactly one outcome wins. `error` (e.g. ENOENT) and `close` can both
		 * fire for the same child, so the guard also keeps the timer cleanup and
		 * any future side effect from running twice.
		 */
		const settle = (): boolean => {
			if (settled) {
				return false;
			}

			settled = true;
			stopTimer();
			if (groupId !== undefined) {
				activeChildren.delete(groupId);
			}

			return true;
		};

		if (options.timeoutMs !== undefined) {
			timer = setTimeout(() => {
				timedOut = true;
				killProcessGroup(child);
				/*
				 * Windows has no group kill and a transport child can keep the
				 * pipes open after the direct child dies, so `close` may never
				 * arrive. Destroying the streams releases the pending reads and
				 * the force-settle rejects with the same timeout error the
				 * normal close path would have produced; `settle` makes the
				 * loser a no-op.
				 */
				forceSettleTimer = setTimeout(() => {
					forceSettleTimer = undefined;
					child.stdout.destroy();
					child.stderr.destroy();
					child.stdin.destroy();

					if (!settle()) {
						return;
					}

					reject(timeoutError());
				}, timeoutKillSettleMs);
			}, options.timeoutMs);
		}

		child.stdout.on('data', (chunk: Buffer) => {
			appendChunk(stdout, chunk);
		});

		child.stderr.on('data', (chunk: Buffer) => {
			appendChunk(stderr, chunk);
			options.onStderrChunk?.(chunk);
		});

		child.stdin.on('error', () => {
			// Git may exit before reading its whole stdin; the resulting EPIPE is
			// expected and the exit code decides the outcome.
		});

		// Stdin is always closed so git can never block waiting for input.
		child.stdin.end(options.input);

		child.on('error', (error: NodeJS.ErrnoException) => {
			if (!settle()) {
				return;
			}

			// A late error after the timeout kill is still a timeout outcome;
			// the overlay must not blame the command for failing to start.
			if (timedOut) {
				reject(timeoutError());
				return;
			}

			if (error.code === 'ENOENT') {
				reject(new GitNotFoundError());
				return;
			}

			reject(
				new GitError(
					cappedDetails({
						args: argv,
						exitCode: undefined,
						stdout: accumulatedText(stdout),
						stderr: accumulatedText(stderr),
					}),
					`git ${argv.join(' ')} could not start: ${error.message}`,
				),
			);
		});

		child.on('close', (code, signal) => {
			if (!settle()) {
				return;
			}

			const stdoutBytes = accumulatedBytes(stdout);
			const details: GitErrorDetails = {
				args: argv,
				exitCode: code ?? undefined,
				stdout: textOf(stdout, stdoutBytes),
				stderr: accumulatedText(stderr),
			};

			const errorDetails = cappedDetails(details);

			if (timedOut) {
				reject(timeoutError());
				return;
			}

			if (code !== null && allowExitCodes.includes(code)) {
				resolve({ ...details, exitCode: code, stdoutBytes });
				return;
			}

			const how =
				signal === null
					? `exited with code ${String(code)}`
					: `was killed by ${signal}`;
			reject(new GitError(errorDetails, `git ${argv.join(' ')} ${how}`));
		});
	});
};

/**
 * `runGit` for commands that only read (status, diff, log, ...).
 *
 * A read gets the read-only flags and a default 120 second timeout so a hung
 * command cannot block the refresh slot forever. Callers may pass a smaller
 * `timeoutMs`; the default applies only when they do not.
 */
export const runGitReadOnly = async (
	args: readonly string[],
	options: Omit<RunGitOptions, 'readOnly'>,
): Promise<GitResult> =>
	runGit(args, {
		...options,
		readOnly: true,
		timeoutMs: options.timeoutMs ?? readOnlyTimeoutMs,
	});
