import { GitError, runGit, type GitResult } from './exec.js';

/**
 * Working-tree mutations built on `runGit`.
 *
 * Every function runs with `cwd` set to the repository root and takes
 * repository-relative paths, because porcelain paths are root-relative and the
 * CLI may have been launched from a nested subdirectory. Paths always follow
 * `--` so a file named `-f` or one that looks like an option can never be read
 * as a flag.
 */

/** Paths per git invocation; long lists are split so argv stays sane. */
const pathsPerCommand = 100;

export type WorkingTreePaths = {
	/** Repository root; porcelain paths are relative to it. */
	readonly cwd: string;
	/** Repository-relative paths; untracked directory rows end in `/`. */
	readonly paths: readonly string[];
	/**
	 * Receives the argv of every command that completed successfully, in
	 * order. A chunked run reports each chunk as it finishes, so a later
	 * failure can still record the commands that already ran.
	 */
	readonly onCommand?: (args: readonly string[]) => void;
};

/**
 * Whether a status path is an untracked directory row.
 *
 * Git collapses untracked directories to `? dir/` (no `--untracked-files=all`),
 * and the panel treats those rows as first-class. The trailing slash is the
 * only marker that survives into the view model, so the two discard commands
 * below split on it.
 */
export const isDirectoryRow = (path: string): boolean => path.endsWith('/');

/** Split `paths` into command-sized chunks; an empty list yields no chunks. */
export const chunkPaths = (
	paths: readonly string[],
	size: number = pathsPerCommand,
): ReadonlyArray<readonly string[]> => {
	const step = Math.max(1, size);
	const chunks: string[][] = [];

	for (let index = 0; index < paths.length; index += step) {
		chunks.push(paths.slice(index, index + step));
	}

	return chunks;
};

/**
 * Run `operation` for every chunk, one command at a time.
 *
 * Serial is the contract: each command writes the index or the worktree of the
 * same repository, so overlapping chunks would race those writes. Each
 * successful command is reported before the next one starts, so a failure
 * partway through still leaves the completed argv history with the caller.
 */
const runEach = async (
	chunks: ReadonlyArray<readonly string[]>,
	operation: (chunk: readonly string[]) => Promise<GitResult>,
	onCommand?: WorkingTreePaths['onCommand'],
): Promise<readonly GitResult[]> => {
	const results: GitResult[] = [];

	for (const chunk of chunks) {
		// eslint-disable-next-line no-await-in-loop -- see the note above
		const result = await operation(chunk);
		onCommand?.(result.args);
		results.push(result);
	}

	return results;
};

/**
 * Whether a failure means this git installation has no `restore` command.
 *
 * Only git's own usage signal counts: exit code 129, or a usage message naming
 * the unknown command or option. A real failure such as a locked index must
 * surface unchanged, because falling back to `reset`/`checkout` there would
 * either repeat the same failure or silently do something else.
 */
const isRestoreUnavailable = (error: unknown): boolean =>
	error instanceof GitError &&
	(error.exitCode === 129 ||
		/'restore' is not a git command|unknown option|unknown switch/i.test(
			error.stderr,
		));

/** `git add -- <paths>`: stages the worktree state of every path. */
export const stage = async (
	mutation: WorkingTreePaths,
): Promise<readonly GitResult[]> =>
	runEach(
		chunkPaths(mutation.paths),
		async chunk => runGit(['add', '--', ...chunk], { cwd: mutation.cwd }),
		mutation.onCommand,
	);

/**
 * `git restore --staged -- <paths>`, with the old-git fallback
 * `git reset HEAD -- <paths>`.
 */
export const unstage = async (
	mutation: WorkingTreePaths,
): Promise<readonly GitResult[]> =>
	runEach(
		chunkPaths(mutation.paths),
		async chunk => {
			try {
				return await runGit(['restore', '--staged', '--', ...chunk], {
					cwd: mutation.cwd,
				});
			} catch (error: unknown) {
				if (!isRestoreUnavailable(error)) {
					throw error;
				}

				return runGit(['reset', 'HEAD', '--', ...chunk], {
					cwd: mutation.cwd,
				});
			}
		},
		mutation.onCommand,
	);

/**
 * `git checkout -m -- <paths>`: recreate a conflict that was resolved in the
 * index.
 *
 * This is the only safe undo for a merge-origin path. `git restore --staged`
 * would drop the unmerged stages and leave an ordinary staged change that
 * cannot be turned back into a conflict; `checkout -m` rebuilds the unmerged
 * index entries and puts the markers back in the worktree.
 */
export const recreateConflict = async (
	mutation: WorkingTreePaths,
): Promise<readonly GitResult[]> =>
	runEach(
		chunkPaths(mutation.paths),
		async chunk =>
			runGit(['checkout', '-m', '--', ...chunk], { cwd: mutation.cwd }),
		mutation.onCommand,
	);

/**
 * `git restore --worktree -- <paths>`, with the old-git fallback
 * `git checkout -- <paths>`.
 *
 * Only the worktree is restored; staged changes stay staged, which is what
 * makes discarding a single tracked file recoverable rather than destructive.
 */
export const discardTracked = async (
	mutation: WorkingTreePaths,
): Promise<readonly GitResult[]> =>
	runEach(
		chunkPaths(mutation.paths),
		async chunk => {
			try {
				return await runGit(['restore', '--worktree', '--', ...chunk], {
					cwd: mutation.cwd,
				});
			} catch (error: unknown) {
				if (!isRestoreUnavailable(error)) {
					throw error;
				}

				return runGit(['checkout', '--', ...chunk], { cwd: mutation.cwd });
			}
		},
		mutation.onCommand,
	);

/**
 * Remove untracked files and directories from the worktree.
 *
 * Directory rows and plain files get separate commands: `-d` is what lets
 * `clean` descend into a collapsed directory row, and it is needed exactly
 * there. `clean` never removes ignored paths without `-x`, which is the
 * guarantee that keeps this safe to run unattended.
 */
export const discardUntracked = async (
	mutation: WorkingTreePaths,
): Promise<readonly GitResult[]> => {
	const directories = mutation.paths.filter(path => isDirectoryRow(path));
	const files = mutation.paths.filter(path => !isDirectoryRow(path));
	const results: GitResult[] = [];

	if (directories.length > 0) {
		results.push(
			...(await runEach(
				chunkPaths(directories),
				async chunk =>
					runGit(['clean', '-f', '-d', '--', ...chunk], { cwd: mutation.cwd }),
				mutation.onCommand,
			)),
		);
	}

	if (files.length > 0) {
		results.push(
			...(await runEach(
				chunkPaths(files),
				async chunk =>
					runGit(['clean', '-f', '--', ...chunk], { cwd: mutation.cwd }),
				mutation.onCommand,
			)),
		);
	}

	return results;
};
