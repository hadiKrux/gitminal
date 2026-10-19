import { GitError, runGit, runGitReadOnly, type GitResult } from './exec.js';

/**
 * Branch mutations built on `runGit`.
 *
 * A checkout can fail on a dirty working tree, and creating a branch can fail
 * before git ever sees it. Both paths throw a `GitError`, so the app's existing
 * operation log and error overlay render git's own message without a special
 * branch error type.
 */

export type BranchRequest = {
	/** Repository root; every branch command runs from there. */
	readonly cwd: string;
	readonly name: string;
	/**
	 * Receives the argv of every command that completed, in order. A failed
	 * command is not reported here; `GitError.args` carries it instead, so the
	 * operation log never records the same argv twice.
	 */
	readonly onCommand?: (args: readonly string[]) => void;
};

/** The message git prints for a name `check-ref-format` rejects. */
const invalidNameMessage = (name: string): string =>
	`fatal: '${name}' is not a valid branch name`;

/**
 * Reject a name git would parse as an option.
 *
 * `spawn` prevents shell injection but not option parsing, so a ref name that
 * starts with a dash must never reach git as an argument. Checkout can pass
 * `--` to end option parsing; `createBranch` cannot (see there), which is why
 * this local guard covers both paths.
 */
const rejectOptionLike = (name: string): void => {
	if (name.startsWith('-')) {
		const message = invalidNameMessage(name);
		throw new GitError(
			{ args: [], exitCode: undefined, stdout: '', stderr: message },
			message,
		);
	}
};

/**
 * Validate a new branch name and create it at HEAD, switching to it.
 *
 * Every name goes through `git check-ref-format --branch`, whose message is
 * surfaced unchanged; a leading dash is rejected before that because git would
 * read it as an option. The switch has no `--` separator: `git switch -c -- name`
 * fails on current git, so the local guard above is what keeps the name from
 * being parsed as an option. Only after validation does the switch run, so an
 * invalid name can never create a ref.
 */
export const createBranch = async (
	request: BranchRequest,
): Promise<readonly GitResult[]> => {
	rejectOptionLike(request.name);

	/*
	 * Exit codes 1 and 128 both mean "invalid name" across git versions. The
	 * result is captured rather than thrown so the caller sees the same argv
	 * that failed; `check-ref-format` writes git's explanation to stderr.
	 */
	const check = await runGitReadOnly(
		['check-ref-format', '--branch', request.name],
		{ cwd: request.cwd, allowExitCodes: [0, 1, 128] },
	);

	if (check.exitCode !== 0) {
		const message = check.stderr.trim() || invalidNameMessage(request.name);
		throw new GitError(
			{
				args: check.args,
				exitCode: check.exitCode,
				stdout: check.stdout,
				stderr: check.stderr,
			},
			message,
		);
	}

	request.onCommand?.(check.args);
	const result = await runGit(['switch', '-c', request.name], {
		cwd: request.cwd,
	});
	request.onCommand?.(result.args);
	return [check, result];
};

/**
 * Switch the worktree to an existing branch.
 *
 * `--` ends option parsing, so a ref name can never be read as a flag even if
 * one reaches this function without the local guard's knowledge.
 */
export const checkout = async (request: BranchRequest): Promise<GitResult> => {
	rejectOptionLike(request.name);
	const result = await runGit(['switch', '--', request.name], {
		cwd: request.cwd,
	});
	request.onCommand?.(result.args);
	return result;
};
