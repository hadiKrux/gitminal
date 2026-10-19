import { sanitizeOutput } from '../data/format.js';
import type { GitError } from './exec.js';
import { missingIdentityHint } from './repo-info.js';

/**
 * Turn a failed git run into the one line the status line shows.
 *
 * Classification starts with what a user can act on: an unset identity gets
 * the shared setup hint, and a commit that failed without git's own `fatal:`
 * line is a rejected hook only when the output names it. Everything else falls
 * back to git's own output, sanitized because the status line renders it
 * literally. CR-framed progress can put many updates on one logical line, so
 * the search splits on both CR and LF and prefers a line that names the
 * failure over whichever progress line happened to come first. The raw output
 * stays untouched on the error for the overlay.
 */

const identityPatterns: readonly RegExp[] = [
	/author identity unknown/i,
	/unable to auto-detect email address/i,
	/empty ident name/i,
	/please tell me who you are/i,
];

/**
 * Hook names git uses around a commit: `pre-commit`, `prepare-commit-msg`,
 * `commit-msg`, and `post-commit`. Matching the generic `pre-`/`post-`/
 * `prepare-` shape also names hooks that only exist in a repository's own
 * configuration, such as a `pre-commit` script that prints its own name.
 */
const hookNamePattern = /\b((?:pre|post|prepare)-[a-z-]+|commit-msg)\b/i;

/**
 * Whether the failing command was `git commit`.
 *
 * `args` carries the global prefix (`--no-pager`, `-c color.ui=false`, and
 * `--no-optional-locks` for reads), so the subcommand is the first token after
 * those flags. Checking `includes('commit')` would also match a path or value
 * literally named `commit` in another command, such as `git add -- commit`.
 */
const isCommit = (error: GitError): boolean => {
	for (let index = 0; index < error.args.length; index += 1) {
		const arg = error.args[index];

		if (arg === undefined) {
			continue;
		}

		if (arg === '-c') {
			// The next token is the `key=value` override, not a subcommand.
			index += 1;
			continue;
		}

		if (arg.startsWith('-')) {
			continue;
		}

		return arg === 'commit';
	}

	return false;
};

/** The cleaned stderr lines, in output order, with blank lines dropped. */
const outputLines = (error: GitError): readonly string[] =>
	sanitizeOutput(error.stderr)
		.split(/[\r\n]+/)
		.map(text => text.trim())
		.filter(text => text.length > 0);

const isIdentityFailure = (output: string): boolean =>
	identityPatterns.some(pattern => pattern.test(output));

/**
 * A commit without git's own `fatal:` line may be a hook rejection: git
 * reports hook failures through the hook's output and exit code, not a fatal
 * line of its own. Return a summary only when the output actually names a
 * hook, so a non-hook failure such as `nothing to commit` is not mislabeled.
 */
const hookFailureSummary = (output: string): string | undefined => {
	const hookName = hookNamePattern.exec(output)?.[1]?.toLowerCase();

	return hookName === undefined ? undefined : `${hookName} hook failed`;
};

export const failureSummary = (error: GitError): string => {
	const lines = outputLines(error);
	const output = lines.join('\n');

	if (isIdentityFailure(output)) {
		return missingIdentityHint;
	}

	if (isCommit(error) && !/fatal:/i.test(output)) {
		const hookSummary = hookFailureSummary(output);

		if (hookSummary !== undefined) {
			return hookSummary;
		}
	}

	const failure = lines.find(text => /fatal|error|failed/i.test(text));

	return failure ?? lines[0] ?? sanitizeOutput(error.message);
};
