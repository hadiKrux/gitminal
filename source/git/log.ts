import { createHash } from 'node:crypto';
import { formatDate } from '../data/format.js';
import type { Commit } from '../data/types.js';
import { runGitReadOnly, truncationMarkerPrefix } from './exec.js';

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
 * Commits read in one command.
 *
 * A window rather than the whole history: an unbounded read on a repository
 * with hundreds of thousands of commits would pay a numstat diff for every one
 * of them on the first paint. Pagination is deferred, so the cap stays. The
 * capture is also capped by `exec.ts`; a truncated read ends the last commit's
 * numstat block at the marker instead of inventing rows from it.
 */
const logWindow = 500;

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
 * Read HEAD's history in one command.
 *
 * One batched read instead of a command per commit, because every row needs
 * counts and the numstat diff is what makes that expensive. The global
 * read-only flags (`--no-pager`, no optional locks, no color) come from
 * `runGitReadOnly`.
 */
export const readLog = async (options: {
	readonly cwd: string;
}): Promise<Commit[]> => {
	const { stdout } = await runGitReadOnly(
		[
			'log',
			logFormat,
			'--numstat',
			'--diff-merges=first-parent',
			'-n',
			String(logWindow),
		],
		{ cwd: options.cwd },
	);

	return parseLog(stdout);
};

/**
 * A cheap digest of every ref name and oid.
 *
 * The log read is expensive, so the refresh needs a cheap way to know whether
 * the decorations it already has are still current. Refs are exactly what
 * moves them: a fetch, a tag, or a branch change moves the digest while a
 * worktree edit does not, so a plain file change never re-reads the log.
 * Hashing keeps the comparison to one short string instead of every ref line.
 */
export const readRefsFingerprint = async (options: {
	readonly cwd: string;
}): Promise<string> => {
	const { stdout } = await runGitReadOnly(
		['for-each-ref', '--format=%(refname)%(objectname)'],
		{ cwd: options.cwd },
	);

	return createHash('sha1').update(stdout).digest('hex');
};
