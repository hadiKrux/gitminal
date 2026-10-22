import { operationTimeoutMs, runGit, type GitResult } from './exec.js';

/**
 * Commit creation built on `runGit`.
 *
 * The message is always one argv element, so a multiline subject and body
 * reach git exactly as typed instead of being split into flags or paths.
 */
export type CommitOptions = {
	/** Skip the repository's pre-commit and commit-msg hooks. */
	readonly noVerify?: boolean;
};

export type CommitRequest = {
	/** Repository root; the app resolves it once and commits from there. */
	readonly cwd: string;
	readonly message: string;
	readonly options?: CommitOptions;
};

/** `git commit -m <message> [--no-verify]` against the staged index. */
export const commit = async (request: CommitRequest): Promise<GitResult> => {
	const args = ['commit', '-m', request.message];

	if (request.options?.noVerify === true) {
		args.push('--no-verify');
	}

	return runGit(args, {
		cwd: request.cwd,
		timeoutMs: operationTimeoutMs,
	});
};
