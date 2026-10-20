import { runGit, type GitResult } from './exec.js';
import { createProgressParser, type ProgressState } from './progress.js';

/**
 * Remote operations the toolbar, keybindings, and remote menu can run.
 *
 * The ids match the command catalog exactly, so the app can hand a command id
 * straight to `runCommand` after checking it with `isRemoteCommandId`.
 */
export type RemoteCommandId =
	| 'pull'
	| 'fetch'
	| 'fetch-prune'
	| 'push'
	| 'push-force'
	| 'push-no-verify';

export type RemoteCommand = {
	readonly id: RemoteCommandId;
	readonly args: readonly string[];
	/** Present-tense label for the running entry and the status line. */
	readonly busy: string;
	/** Past-tense summary recorded when the command succeeds. */
	readonly done: string;
};

/**
 * The exact argv each remote command runs.
 *
 * `--progress` is forced even when stderr is not a TTY: git suppresses
 * progress automatically, and the parser needs those lines to drive the bar.
 * `pull --no-edit` merges without opening an editor; the exec env policy also
 * sets `GIT_EDITOR=true`, but the flag states the intent at the call site.
 * The force variant is `--force-with-lease`, not a bare `--force`, so a force
 * push can never overwrite a commit this clone has not seen.
 */
export const remoteCommands: Readonly<Record<RemoteCommandId, RemoteCommand>> =
	{
		pull: {
			id: 'pull',
			args: ['pull', '--no-edit', '--progress'],
			busy: 'pulling',
			done: 'pulled',
		},
		fetch: {
			id: 'fetch',
			args: ['fetch', '--progress'],
			busy: 'fetching',
			done: 'fetched',
		},
		'fetch-prune': {
			id: 'fetch-prune',
			args: ['fetch', '--progress', '--prune'],
			busy: 'fetching with prune',
			done: 'fetched and pruned',
		},
		push: {
			id: 'push',
			args: ['push', '--progress'],
			busy: 'pushing',
			done: 'pushed',
		},
		'push-force': {
			id: 'push-force',
			args: ['push', '--progress', '--force-with-lease'],
			busy: 'force-pushing',
			done: 'force-pushed',
		},
		'push-no-verify': {
			id: 'push-no-verify',
			args: ['push', '--progress', '--no-verify'],
			busy: 'pushing',
			done: 'pushed',
		},
	};

/** Type guard for the string ids coming from the command catalog. */
export const isRemoteCommandId = (value: string): value is RemoteCommandId =>
	Object.hasOwn(remoteCommands, value);

/**
 * How long a remote command may run before the process group is killed.
 *
 * Long enough for a real transfer over a slow link, short enough that a dead
 * host or a stalled server cannot leave the TUI busy forever. A caller can
 * override it (the timeout verification deliberately uses a short value).
 */
export const remoteTimeoutMs = 30_000;

/**
 * A progress state that definitely has a phase.
 *
 * The parser only reports states with a recognized phase line, so exposing
 * the narrowed shape lets consumers render the phase without re-checking it.
 */
export type RemoteProgress = ProgressState & { readonly phase: string };

export type RemoteCommandOptions = {
	/** Repository root; every command runs from there. */
	readonly cwd: string;
	readonly timeoutMs?: number;
	/** Receives every parsed state that names a phase. */
	readonly onProgress?: (progress: RemoteProgress) => void;
	/** Receives the argv once the command completes. */
	readonly onCommand?: (args: readonly string[]) => void;
};

/**
 * Run one remote operation with live progress.
 *
 * A fresh parser per command is what keeps a percentage from a previous
 * fetch out of the next one. The final `flush` is in `finally` because git
 * often ends the stream on a bare carriage return: without it the last
 * phase and percentage would never reach the status line. `onCommand` runs
 * only on success; a failure's argv travels on `GitError.args`, so the log
 * never records the same command twice.
 */
export const runCommand = async (
	id: RemoteCommandId,
	options: RemoteCommandOptions,
): Promise<GitResult> => {
	const command = remoteCommands[id];
	const parser = createProgressParser();
	const report = (progress: ProgressState): void => {
		if (progress.phase !== undefined) {
			options.onProgress?.({ ...progress, phase: progress.phase });
		}
	};

	try {
		const result = await runGit(command.args, {
			cwd: options.cwd,
			timeoutMs: options.timeoutMs ?? remoteTimeoutMs,
			onStderrChunk(chunk) {
				report(parser.push(chunk));
			},
		});
		options.onCommand?.(result.args);
		return result;
	} finally {
		report(parser.flush());
	}
};
