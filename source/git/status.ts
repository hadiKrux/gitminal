import type { Buffer } from 'node:buffer';
import {
	capStoredOutput,
	GitError,
	runGitReadOnly,
	truncationMarkerPrefix,
} from './exec.js';

/** One side of a changed path: `.` means unchanged on that side. */
export type StatusCode = '.' | 'M' | 'A' | 'D' | 'R' | 'C' | 'T';

/**
 * One changed path as git reports it.
 *
 * `index` is the staged side and `worktree` the unstaged side; both stay
 * available so the view model can derive `staged`/`hasUnstaged` without
 * re-reading anything. Rename/copy entries carry the source path separately,
 * exactly as the `-z` stream frames it.
 */
export type StatusEntry =
	| {
			readonly kind: 'changed';
			readonly path: string;
			readonly index: StatusCode;
			readonly worktree: StatusCode;
	  }
	| {
			readonly kind: 'renamed';
			readonly path: string;
			/** The path the file was renamed or copied from. */
			readonly from: string;
			readonly index: StatusCode;
			readonly worktree: StatusCode;
	  }
	| { readonly kind: 'unmerged'; readonly path: string; readonly code: string }
	| { readonly kind: 'untracked'; readonly path: string };

/** Which branch HEAD points at, or that it points at a commit instead. */
export type BranchState =
	| {
			readonly kind: 'branch';
			readonly name: string;
			/** Undefined while the branch has no commits yet (`(initial)`). */
			readonly oid: string | undefined;
	  }
	| { readonly kind: 'detached'; readonly oid: string };

/**
 * The git-side view of `git status --porcelain=v2 --branch`.
 *
 * This is deliberately not a view model: it keeps commit oids, raw codes, and
 * marker states so every UI decision stays a pure mapping in `data/map.ts`.
 */
export type RepoStatus = {
	readonly branch: BranchState;
	readonly upstream: string | undefined;
	readonly ahead: number;
	readonly behind: number;
	readonly entries: readonly StatusEntry[];
};

type Headers = {
	oid: string | undefined;
	head: string | undefined;
	upstream: string | undefined;
	ahead: number;
	behind: number;
};

type StatusRecord = {
	readonly fields: readonly string[];
	/** The trailing path; fields never contain spaces, paths may. */
	readonly path: string;
};

/**
 * Split a record into its space-separated fields plus the trailing path.
 *
 * The path may contain spaces, so only the first `fieldCount` fields are split
 * off and everything after them is joined back into the path.
 */
const splitRecord = (token: string, fieldCount: number): StatusRecord => {
	const parts = token.split(' ');

	return {
		fields: parts.slice(1, 1 + fieldCount),
		path: parts.slice(1 + fieldCount).join(' '),
	};
};

const toCode = (value: string | undefined): StatusCode => {
	switch (value) {
		case 'M':
		case 'A':
		case 'D':
		case 'R':
		case 'C':
		case 'T': {
			return value;
		}

		default: {
			return '.';
		}
	}
};

const parseHeader = (token: string, headers: Headers): void => {
	const rest = token.slice(2);
	const space = rest.indexOf(' ');
	const key = space === -1 ? rest : rest.slice(0, space);
	const value = space === -1 ? '' : rest.slice(space + 1);

	switch (key) {
		case 'branch.oid': {
			// `(initial)` marks a branch that has no commits yet.
			headers.oid = value === '(initial)' ? undefined : value;
			break;
		}

		case 'branch.head': {
			// `(detached)` and `(unknown)` are markers, not branch names.
			headers.head = value;
			break;
		}

		case 'branch.upstream': {
			headers.upstream = value;
			break;
		}

		case 'branch.ab': {
			const match = /^\+(\d+) -(\d+)$/.exec(value);

			if (match !== null) {
				const [, ahead = '0', behind = '0'] = match;
				headers.ahead = Number(ahead);
				headers.behind = Number(behind);
			}

			break;
		}

		default: {
			// Unknown header lines are ignored so new git versions cannot break us.
			break;
		}
	}
};

/**
 * Parse the NUL-separated porcelain v2 stream.
 *
 * The `-z` form is split on `\0` precisely because paths may contain anything
 * except NUL (spaces, quotes, newlines), and rename records carry their source
 * path as a separate NUL-terminated token. Keeping this pure and separate from
 * the exec call makes it exercisable directly against the raw fixtures, so it
 * takes bytes as well as decoded text.
 */
export const parseStatus = (stdout: string | Buffer): RepoStatus => {
	const text = typeof stdout === 'string' ? stdout : stdout.toString('utf8');
	const tokens = text.split('\0');
	const entries: StatusEntry[] = [];
	const headers: Headers = {
		oid: undefined,
		head: undefined,
		upstream: undefined,
		ahead: 0,
		behind: 0,
	};

	let cursor = 0;

	while (cursor < tokens.length) {
		const token = tokens[cursor];
		cursor += 1;

		if (token === undefined || token.length === 0) {
			continue;
		}

		if (token.startsWith('# ')) {
			parseHeader(token, headers);
			continue;
		}

		switch (token[0]) {
			case '1': {
				const { fields, path } = splitRecord(token, 7);
				const xy = fields[0];
				entries.push({
					kind: 'changed',
					path,
					index: toCode(xy?.[0]),
					worktree: toCode(xy?.[1]),
				});
				break;
			}

			case '2': {
				const { fields, path } = splitRecord(token, 8);
				const xy = fields[0];
				const from = tokens[cursor] ?? '';
				cursor += 1;
				entries.push({
					kind: 'renamed',
					path,
					from,
					index: toCode(xy?.[0]),
					worktree: toCode(xy?.[1]),
				});
				break;
			}

			case 'u': {
				// Nine fields before the path: XY, sub, four modes (m1..mW),
				// three object names (h1..h3).
				const { fields, path } = splitRecord(token, 9);
				entries.push({ kind: 'unmerged', path, code: fields[0] ?? 'UU' });
				break;
			}

			case '?': {
				entries.push({ kind: 'untracked', path: token.slice(2) });
				break;
			}

			default: {
				// `!` (ignored) rows only appear with --ignored, which we never pass.
				break;
			}
		}
	}

	const branch: BranchState =
		headers.head === '(detached)' && headers.oid !== undefined
			? { kind: 'detached', oid: headers.oid }
			: {
					kind: 'branch',
					name: headers.head ?? '(unknown)',
					oid: headers.oid,
			  };

	return {
		branch,
		upstream: headers.upstream,
		ahead: headers.ahead,
		behind: headers.behind,
		entries,
	};
};

/**
 * Read the paths that currently have unmerged index entries.
 *
 * A rendered status snapshot is observation, not authority: an external
 * `git add`, merge, or checkout can change the index after the last load.
 * `git ls-files -u -z` is the authoritative answer a destructive action must
 * read right before it runs, because `git restore --staged` on an unmerged
 * path drops its stages. Every record is `mode SP oid SP stage TAB path`, so
 * the path is everything after the first tab; a path with several stages is
 * one path, hence the set.
 */
export const readUnmergedPaths = async (options: {
	readonly cwd: string;
}): Promise<ReadonlySet<string>> => {
	const result = await runGitReadOnly(['ls-files', '-u', '-z'], {
		cwd: options.cwd,
	});

	/*
	 * Fail closed on a truncated capture. The marker exists only on the
	 * decoded `stdout`; `stdoutBytes` is a hard-capped prefix that can end
	 * mid-record, so parsing it would silently omit unmerged paths and let a
	 * later restore reach them. Failing the read makes the queued unstage
	 * record an error and run no command.
	 */
	if (result.stdout.includes(truncationMarkerPrefix)) {
		const message =
			'git ls-files -u output was truncated; refusing to unstage because unmerged paths may be missing';

		throw new GitError(
			{
				args: [],
				exitCode: undefined,
				stdout: capStoredOutput(result.stdout),
				stderr: message,
			},
			message,
		);
	}

	const paths = new Set<string>();

	for (const record of result.stdoutBytes.toString('utf8').split('\0')) {
		if (record.length === 0) {
			continue;
		}

		const tab = record.indexOf('\t');
		if (tab !== -1) {
			paths.add(record.slice(tab + 1));
		}
	}

	return paths;
};

/**
 * Read the working tree state of the repository at `cwd`.
 *
 * `--untracked-files=normal` is explicit on purpose: a user config
 * (`status.showUntrackedFiles=all`) must not turn the collapsed `? dir/` row
 * into one row per file, because the panel treats the directory row as a
 * first-class entry (discard, diff note).
 *
 * The raw bytes go to the parser: `-z` is a NUL-separated byte stream, and
 * decoding to UTF-8 first would mangle non-UTF-8 path bytes before the split.
 */
export const readStatus = async (options: {
	readonly cwd: string;
}): Promise<RepoStatus> => {
	const result = await runGitReadOnly(
		['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=normal'],
		{ cwd: options.cwd },
	);

	/*
	 * Fail closed on a truncated capture, like the unmerged-path read above.
	 * The marker exists only on the decoded `stdout`; `stdoutBytes` is a hard
	 * cap that can end mid-path, so parsing it would invent a row for a path
	 * that may not exist while silently omitting the rest. A synthetic exit
	 * code (undefined) keeps the overlay from claiming git exited 0.
	 */
	if (result.stdout.includes(truncationMarkerPrefix)) {
		const message =
			'git status output was truncated; repository has too many changes to display safely';

		throw new GitError(
			{
				// A synthetic failure, not a successful command's argv: the
				// overlay says `no exit code` and the console does not blame
				// status for a read that actually succeeded.
				args: [],
				exitCode: undefined,
				stdout: capStoredOutput(result.stdout),
				stderr: message,
			},
			message,
		);
	}

	return parseStatus(result.stdoutBytes);
};
