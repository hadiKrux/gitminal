import { createHash } from 'node:crypto';
import { formatDate } from '../data/format.js';
import type { Commit } from '../data/types.js';
import {
	capStoredOutput,
	GitError,
	runGitReadOnly,
	truncationMarkerPrefix,
} from './exec.js';

/**
 * Record and field separators for the batched log format.
 *
 * A commit subject may contain almost anything, so the commit boundary is a
 * control byte rather than a line: the parser can split the whole output into
 * records without guessing where one commit ends and the next begins. `%x1e`
 * and `%x1f` are git's own hex escapes, so the argv stays printable.
 */
const recordSeparator = '\u001E';
const fieldSeparator = '\u001F';

/**
 * Commits read in one page.
 *
 * A window rather than the whole history: an unbounded read on a repository
 * with hundreds of thousands of commits would pay a numstat diff for every one
 * of them on the first paint. Older pages are read only when the selection
 * reaches the end of the list. The capture is also capped by `exec.ts`; a
 * truncated read ends the last commit's numstat block at the marker instead of
 * inventing rows from it.
 */
const logWindow = 500;

/** One page of history plus whether git printed another commit after it. */
export type LogPage = {
	readonly commits: readonly Commit[];
	readonly hasMore: boolean;
};

/**
 * `git log` fields, in the order `parseLog` reads them.
 *
 * The batched format is not NUL-separated (`-z`): a subject containing the
 * `\x1f` field separator, or a numstat path containing a tab or newline, would
 * split wrongly. Accepted for this read format; `--numstat -z` can be
 * revisited if pagination ever needs it.
 */
const logFormat = '--format=%x1e%H%x1f%P%x1f%an%x1f%aI%x1f%s%x1f%D';

/**
 * A numstat count as a number.
 *
 * Binary rows carry `-` instead of a count, and a truncated capture can leave
 * an empty field; both mean "no countable lines", not "fail the parse".
 */
const toCount = (value: string | undefined): number => {
	const count = Number.parseInt(value ?? '', 10);
	return Number.isFinite(count) ? count : 0;
};

/**
 * Decoration chips from `%D`.
 *
 * Git writes `HEAD -> main`, `tag: v1.0.0`, and `origin/main` into one
 * comma-separated list; the arrow and the `tag:` prefix are git's own labels,
 * not part of any name, so both are stripped before the names become chips.
 */
const parseTags = (decorations: string): string[] =>
	decorations
		.split(',')
		.map(part => part.trim())
		.map(part => part.replace(/^HEAD -> /, '').replace(/^tag: /, ''))
		.filter(part => part.length > 0);

/**
 * Parse the batched log stream into commits, newest first.
 *
 * Each `\x1e`-framed record is the header fields (`%H %P %an %aI %s %D`,
 * `\x1f`-separated) followed by the commit's numstat block. Counting each
 * numstat row as one file and summing the two count columns keeps the file
 * count and the `+add -del` totals consistent with `git log --numstat`,
 * including merge commits, whose first-parent diff
 * `--diff-merges=first-parent` makes git emit. Binary rows (`-`) count as one
 * file with no line counts.
 *
 * Malformed input must never throw: a truncated capture or a git version
 * writing unexpected bytes still yields the commits that did parse, because
 * the list renders what is known instead of failing the whole panel.
 *
 * Pagination is deliberately outside the parser: `readLog` asks for one extra
 * commit and drops it, so this stays a pure mapping of whatever git printed.
 */
export const parseLog = (stdout: string): Commit[] => {
	const commits: Commit[] = [];

	for (const record of stdout.split(recordSeparator)) {
		if (record.trim().length === 0) {
			continue;
		}

		const newline = record.indexOf('\n');
		const header = newline === -1 ? record : record.slice(0, newline);
		const [hash, parents, author, date, message, decorations] =
			header.split(fieldSeparator);

		if (hash === undefined || hash.length === 0) {
			continue;
		}

		let fileCount = 0;
		let additions = 0;
		let deletions = 0;
		const numstat = newline === -1 ? '' : record.slice(newline + 1);

		for (const row of numstat.split('\n')) {
			// The cap cut the capture; the remaining text is the marker, not a
			// numstat row, so stop before it inflates this commit's file count.
			if (row.startsWith(truncationMarkerPrefix)) {
				break;
			}

			if (row.length === 0) {
				continue;
			}

			const [added, removed] = row.split('\t');
			fileCount += 1;
			additions += toCount(added);
			deletions += toCount(removed);
		}

		commits.push({
			hash,
			parents: (parents ?? '').split(' ').filter(parent => parent.length > 0),
			message: message ?? '',
			author: author ?? '',
			date: formatDate(date ?? ''),
			fileCount,
			additions,
			deletions,
			tags: parseTags(decorations ?? ''),
		});
	}

	return commits;
};

/**
 * Read one page of HEAD's history.
 *
 * One batched read instead of a command per commit, because every row needs
 * counts and the numstat diff is what makes that expensive. The global
 * read-only flags (`--no-pager`, no optional locks, no color) come from
 * `runGitReadOnly`.
 *
 * The read requests `limit + 1` commits and drops the last one: the extra row
 * is a cheap probe for whether older history exists. `--skip` starts the page
 * after the commits already loaded, so paging never repeats a commit.
 *
 * A capture that hit the byte cap proves more history exists, but its last
 * record may be cut mid-header or mid-numstat. That partial commit is dropped
 * and `hasMore` stays true: a truncated read must never be mistaken for the
 * end of history, or older commits become unreachable.
 *
 * A page whose numstat block alone exceeds the cap would otherwise leave one
 * partial commit in the capture and, after the drop, no rows at all: the
 * caller would keep asking for the same page and never advance. That case is
 * retried without `--numstat` for the same window. The header-only page has no
 * counts, but it advances the window and proves pagination cannot wedge; its
 * own partial last header is dropped when that capture is truncated too. If
 * even a header does not fit, the read fails with a synthetic error instead of
 * returning an empty page that claims more history exists.
 */
export const readLog = async (options: {
	readonly cwd: string;
	readonly skip?: number;
	readonly limit?: number;
}): Promise<LogPage> => {
	const skip = Math.max(0, options.skip ?? 0);
	const limit = Math.max(0, options.limit ?? logWindow);
	const pageArgs = (withNumstat: boolean): string[] => {
		const args = ['log', logFormat];

		if (withNumstat) {
			args.push('--numstat');
		}

		args.push(
			'--diff-merges=first-parent',
			'--skip',
			String(skip),
			'-n',
			String(limit + 1),
		);

		return args;
	};

	const { stdout } = await runGitReadOnly(pageArgs(true), { cwd: options.cwd });
	const isTruncated = stdout.includes(truncationMarkerPrefix);
	const parsed = parseLog(stdout);
	const commits = isTruncated ? parsed.slice(0, -1) : parsed;

	if (!isTruncated || parsed.length > 1) {
		return {
			commits: commits.slice(0, limit),
			hasMore: isTruncated || commits.length > limit,
		};
	}

	// At most one parsed record means the drop left no commit at all. Read the
	// same window again without numstat so the page can still advance.
	const fallback = await runGitReadOnly(pageArgs(false), { cwd: options.cwd });
	const fallbackTruncated = fallback.stdout.includes(truncationMarkerPrefix);
	const fallbackParsed = parseLog(fallback.stdout);
	const fallbackCommits = fallbackTruncated
		? fallbackParsed.slice(0, -1)
		: fallbackParsed;

	if (fallbackCommits.length === 0) {
		const message =
			'git log page is too large to read; no commit header fit in the output cap';

		throw new GitError(
			{
				// Nothing failed to start or exit: the capture itself is too
				// large, so there is no command to blame in the console.
				args: [],
				exitCode: undefined,
				stdout: capStoredOutput(fallback.stdout),
				stderr: message,
			},
			message,
		);
	}

	return {
		commits: fallbackCommits.slice(0, limit),
		hasMore: fallbackTruncated || fallbackCommits.length > limit,
	};
};

/**
 * A cheap digest of everything the sidebar renders as refs.
 *
 * The log read is expensive, so the refresh needs a cheap way to know whether
 * the decorations it already has are still current. Refs are exactly what
 * moves them: a fetch, a tag, or a branch change moves the digest while a
 * worktree edit does not, so a plain file change never re-reads the log. The
 * sidebar adds three inputs beyond ref names and oids: a branch's configured
 * upstream (`%(upstream)`), the worktree list, and submodule status. Including
 * all of them means a linked worktree added, a submodule checked out at a new
 * commit, or an upstream retargeted invalidates the same cache as a moved ref.
 * Hashing keeps the comparison to one short string instead of every line.
 *
 * Each probe is best effort. A probe that fails or whose capture was truncated
 * contributes a monotonically increasing failure marker instead of failing the
 * whole refresh: the digest then differs from every earlier digest, so this
 * load's caches miss and the next successful load re-reads them, rather than
 * silently trusting a digest built from a partial or missing stream.
 */
let refsProbeFailureCount = 0;

const readFingerprintProbe = async (
	cwd: string,
	args: readonly string[],
): Promise<string | undefined> => {
	try {
		const { stdout } = await runGitReadOnly(args, { cwd });
		return stdout.includes(truncationMarkerPrefix) ? undefined : stdout;
	} catch {
		return undefined;
	}
};

export const readRefsFingerprint = async (options: {
	readonly cwd: string;
}): Promise<string> => {
	const { cwd } = options;
	const [refs, worktrees, submodules] = await Promise.all([
		readFingerprintProbe(cwd, [
			'for-each-ref',
			'--format=%(refname)%(objectname)%(upstream)',
		]),
		readFingerprintProbe(cwd, ['worktree', 'list', '--porcelain']),
		readFingerprintProbe(cwd, ['submodule', 'status']),
	]);
	const failed =
		refs === undefined || worktrees === undefined || submodules === undefined;

	const digest = createHash('sha1')
		// Labels separate the three streams so one command's output cannot be
		// mistaken for another's at a boundary.
		.update('refs\n')
		.update(refs ?? '')
		.update('\nworktrees\n')
		.update(worktrees ?? '')
		.update('\nsubmodules\n')
		.update(submodules ?? '');

	if (failed) {
		refsProbeFailureCount += 1;
		digest.update(`\nfailures\n${refsProbeFailureCount}`);
	}

	return digest.digest('hex');
};
