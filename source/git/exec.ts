import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Buffer } from 'node:buffer';
import process from 'node:process';

/** Shared cap for accumulated stdout/stderr. */
const maxOutputBytes = 10 * 1024 * 1024;

const truncationMarker = `\n[... output truncated at ${maxOutputBytes} bytes ...]`;

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
 */
const globalFlags = (readOnly: boolean | undefined): string[] => {
	const flags = ['--no-pager', '-c', 'color.ui=false'];

	if (readOnly === true) {
		flags.push('--no-optional-locks');
	}

	return flags;
};

/**
 * Kill git and everything it spawned.
 *
 * Spawned detached, git leads its own process group, so signalling the group
 * reaches transport children (ssh, git-remote-https) that would otherwise keep
 * the output pipes open and the promise unresolved.
 */
const killProcessGroup = (child: ChildProcessWithoutNullStreams): void => {
	if (child.pid === undefined) {
		return;
	}

	try {
		process.kill(-child.pid, 'SIGKILL');
	} catch {
		child.kill('SIGKILL');
	}
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
	const argv = [...globalFlags(options.readOnly), ...args];
	const allowExitCodes = options.allowExitCodes ?? [0];

	return new Promise<GitResult>((resolve, reject) => {
		const child = spawn('git', argv, {
			cwd: options.cwd,
			env: { ...process.env, ...gitEnvPolicy },
			stdio: ['pipe', 'pipe', 'pipe'],
			detached: true,
		});

		const stdout: Accumulator = { chunks: [], length: 0, truncated: false };
		const stderr: Accumulator = { chunks: [], length: 0, truncated: false };
		let timedOut = false;
		let settled = false;
		let timer: NodeJS.Timeout | undefined;

		const stopTimer = (): void => {
			if (timer !== undefined) {
				clearTimeout(timer);
				timer = undefined;
			}
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
			return true;
		};

		if (options.timeoutMs !== undefined) {
			timer = setTimeout(() => {
				timedOut = true;
				killProcessGroup(child);
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

			if (error.code === 'ENOENT') {
				reject(new GitNotFoundError());
				return;
			}

			reject(
				new GitError(
					{
						args: argv,
						exitCode: undefined,
						stdout: accumulatedText(stdout),
						stderr: accumulatedText(stderr),
					},
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

			if (timedOut) {
				reject(
					new GitError(
						details,
						`git ${argv.join(' ')} timed out after ${
							options.timeoutMs ?? 0
						} ms`,
						true,
					),
				);
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
			reject(new GitError(details, `git ${argv.join(' ')} ${how}`));
		});
	});
};

/** `runGit` for commands that only read (status, diff, log, ...). */
export const runGitReadOnly = async (
	args: readonly string[],
	options: Omit<RunGitOptions, 'readOnly'>,
): Promise<GitResult> => runGit(args, { ...options, readOnly: true });
