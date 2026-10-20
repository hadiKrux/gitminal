import { sanitizeOutput, splitOutputLines } from '../data/format.js';
import type { GitError } from './exec.js';
import { missingIdentityHint } from './repo-info.js';

/**
 * Turn a failed git run into the one line the status line shows.
 *
 * Classification starts with what a user can act on: a timeout is the
 * process, not git's message; an unset identity gets the shared setup hint; an
 * unmerged index names the conflict instead of the raw fatal line; and a commit
 * or push that failed without git's own `fatal:` line is a rejected hook only
 * when the output names it. The transport failures a
 * remote operation produces come next, each as a short summary plus the one
 * action that resolves it. Everything else falls back to git's own output,
 * sanitized because the status line renders it literally. CR-framed progress
 * can put many updates on one logical line, so the search splits on both CR
 * and LF and prefers a line that names the failure over whichever progress
 * line happened to come first. The raw output stays untouched on the error
 * for the overlay.
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
 * Server-side `pre-receive` and `post-receive` hooks print the same shape.
 * The `update` hook is the exception: it reports `update hook declined` or
 * `hook declined` instead of a `pre-`/`post-` name, so it needs its own
 * context-anchored match.
 */
const hookNamePattern = /\b((?:pre|post|prepare)-[a-z-]+|commit-msg)\b/i;

/** Server-side `update` hook wording, which never prints a hyphenated name. */
const updateHookPattern = /\bupdate hook\b|\bhook declined\b/i;

/**
 * The git subcommand that failed, or undefined when only global flags ran.
 *
 * `args` carries the global prefix (`--no-pager`, `-c color.ui=false`, and
 * `--no-optional-locks` for reads), so the subcommand is the first token after
 * those flags. Checking `includes('commit')` would also match a path or value
 * literally named `commit` in another command, such as `git add -- commit`.
 */
const subcommandOf = (args: readonly string[]): string | undefined => {
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];

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

		return arg;
	}

	return undefined;
};

/** The cleaned stderr lines, in output order, with blank lines dropped. */
const outputLines = (error: GitError): readonly string[] =>
	splitOutputLines(error.stderr)
		.map(text => text.trim())
		.filter(text => text.length > 0);

const isIdentityFailure = (output: string): boolean =>
	identityPatterns.some(pattern => pattern.test(output));

/**
 * A commit or push without git's own `fatal:` line may be a hook rejection:
 * git reports hook failures through the hook's output and exit code, not a
 * fatal line of its own. Return a summary only when the output actually names
 * a hook, so a non-hook failure such as `nothing to commit` is not mislabeled.
 */
const hookFailureSummary = (output: string): string | undefined => {
	const hookName = hookNamePattern.exec(output)?.[1]?.toLowerCase();

	if (hookName !== undefined) {
		return `${hookName} hook failed`;
	}

	// A generic `hook declined` is the update hook's wording; checking it
	// after the named hooks keeps a `pre-receive hook declined` line from
	// being relabeled as an update rejection.
	return updateHookPattern.test(output) ? 'update hook failed' : undefined;
};

/**
 * Auth that needs a prompt, which the exec policy disables.
 *
 * `GIT_TERMINAL_PROMPT=0` turns a missing credential into this message
 * instead of a terminal prompt no TUI can show, so the summary names the
 * reason and the policy rather than pretending the credential was wrong.
 */
const isInteractiveAuthFailure = (output: string): boolean =>
	/could not read (?:username|password)/i.test(output) ||
	/terminal prompts disabled/i.test(output);

/**
 * A credential was supplied and the server refused it.
 *
 * A bare 401 is not enough: a progress count can print `(401/401)` and a
 * remote URL can carry port 401, and either would otherwise masquerade as an
 * auth failure. Only an HTTP status context counts.
 */
const isAuthRejected = (output: string): boolean =>
	/authentication failed/i.test(output) ||
	/access denied/i.test(output) ||
	/\b401 unauthorized\b/i.test(output) ||
	/requested url returned error: 401\b/i.test(output) ||
	/\bhttp(?:\/[\d.]+)? 401\b/i.test(output);

/** Push output describing a branch the remote will not fast-forward. */
const isNonFastForward = (output: string): boolean =>
	/non-fast-forward/i.test(output) ||
	(/\[rejected]/i.test(output) && /fetch first/i.test(output)) ||
	/remote contains work/i.test(output);

/**
 * A `--force-with-lease` rejection: the remote moved since the last fetch, so
 * the lease no longer matches the local tracking ref. The fix is to fetch and
 * retry, not to force harder.
 */
const isStaleLease = (output: string): boolean =>
	/stale info/i.test(output) ||
	/remote ref updated since checkout/i.test(output);

const noUpstreamPattern = /has no upstream branch/i;

/**
 * Git's refusal to commit while the index still holds unmerged entries.
 *
 * A merge conflict is not a generic commit failure, so the status line names
 * the actual blocker instead of echoing whichever `error:`/`fatal:` line came
 * first. Both wordings come from git's commit path.
 */
const isUnmergedCommitFailure = (output: string): boolean =>
	/committing is not possible because you have unmerged files/i.test(output) ||
	/exiting because of an unresolved conflict/i.test(output);

/**
 * The branch git named in a missing-upstream message, or HEAD when the
 * wording is not one this git version prints. Branch names cannot contain
 * spaces, so the capture stops at whitespace; `HEAD` keeps the hint valid
 * even when nothing could be extracted.
 */
const noUpstreamBranch = (output: string): string =>
	/current branch (\S+) has no upstream branch/i.exec(output)?.[1] ?? 'HEAD';

/**
 * Classify a failed git run into the status line's short summary.
 *
 * Order is deliberate: a timeout killed the process group, so git's captured
 * output is incomplete and its last line may describe a phase rather than the
 * failure. Identity and hook failures keep their existing priority because
 * they are local preconditions; transport failures only match their own
 * distinctive wording. The generic fallback remains git's own failure line.
 */
export const failureSummary = (error: GitError): string => {
	if (error.timedOut) {
		return 'timed out; operation killed';
	}

	const lines = outputLines(error);
	const output = lines.join('\n');

	if (isIdentityFailure(output)) {
		return missingIdentityHint;
	}

	if (isUnmergedCommitFailure(output)) {
		return 'unmerged files; resolve them before committing';
	}

	const subcommand = subcommandOf(error.args);
	if (
		(subcommand === 'commit' || subcommand === 'push') &&
		!/fatal:/i.test(output)
	) {
		const hookSummary = hookFailureSummary(output);

		if (hookSummary !== undefined) {
			return hookSummary;
		}
	}

	if (isInteractiveAuthFailure(output)) {
		return 'authentication required; terminal prompts disabled';
	}

	if (isAuthRejected(output)) {
		return 'authentication failed';
	}

	if (isNonFastForward(output)) {
		return 'push rejected: non-fast-forward; pull first';
	}

	if (isStaleLease(output)) {
		return 'push rejected: stale remote state; fetch first';
	}

	if (noUpstreamPattern.test(output)) {
		return `no upstream branch; git push -u origin ${noUpstreamBranch(output)}`;
	}

	if (/could not resolve host/i.test(output)) {
		return 'network unreachable: could not resolve host';
	}

	if (
		/failed to connect/i.test(output) ||
		/couldn't connect to server/i.test(output) ||
		/connection (?:refused|reset)/i.test(output)
	) {
		return 'network unreachable; check the remote URL and connection';
	}

	const failure = lines.find(text => /fatal|error|failed/i.test(text));

	return failure ?? lines[0] ?? sanitizeOutput(error.message);
};
