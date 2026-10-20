import type { Buffer } from 'node:buffer';
import os from 'node:os';
import process from 'node:process';
import type { DiffLine, WorkingFile } from '../data/types.js';
import { runGitReadOnly } from './exec.js';
import { isDirectoryRow } from './working-tree.js';

/** Where a row's diff comes from; it also decides the cache signature. */
export type DiffSource =
	| 'staged'
	| 'unstaged'
	| 'untracked-file'
	| 'untracked-directory'
	| 'conflicted';

/** Additions/deletions for one row, plus the binary marker numstat cannot count. */
export type DiffStat = {
	readonly additions: number;
	readonly deletions: number;
	readonly binary: boolean;
};

const emptyStat: DiffStat = { additions: 0, deletions: 0, binary: false };

/** Path used as the "before" side of an untracked file's diff. */
const nullDevice = process.platform === 'win32' ? 'NUL' : os.devNull;

/** Files listed under an untracked directory before the note is capped. */
const directoryFileCap = 20;

/**
 * Per-file `git diff --no-index` commands allowed to run at once.
 *
 * Small enough that a repository with many untracked files never starts a git
 * process per file in the same instant, large enough that the stats read is not
 * one sequential spawn after another on every refresh.
 */
const untrackedStatBatchSize = 4;

/**
 * Which diff a row represents.
 *
 * A staged row deliberately shows the staged side even when the worktree has
 * newer edits: the row's status letter is the index side too, and the diff must
 * explain what a commit would record. Untracked paths split on the trailing
 * slash because git never hands a directory to `diff --no-index`. A conflicted
 * path has no meaningful side to compare, so it reads the worktree file itself.
 */
export const diffSourceOf = (file: WorkingFile): DiffSource => {
	if (file.status === 'conflicted') {
		return 'conflicted';
	}

	if (file.status === 'untracked') {
		return isDirectoryRow(file.path) ? 'untracked-directory' : 'untracked-file';
	}

	return file.staged ? 'staged' : 'unstaged';
};

const headerLine = (text: string): DiffLine => ({
	kind: 'header',
	oldNumber: undefined,
	newNumber: undefined,
	text,
});

/**
 * Completed reads always render something.
 *
 * A mode-only change, or a path whose content already matches, produces no
 * textual diff. An empty row list would collapse the expanded panel to nothing
 * and read as broken, so the read explains itself with one header row instead.
 */
const withNoDiffNote = (lines: readonly DiffLine[]): readonly DiffLine[] =>
	lines.length > 0 ? lines : [headerLine('no textual diff')];

/** Strip only the trailing CR so CRLF output parses like LF output. */
const stripCarriageReturn = (line: string): string =>
	line.endsWith('\r') ? line.slice(0, -1) : line;

const hunkPattern = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Turn unified diff text into display rows.
 *
 * The line counters come from each `@@ -a,b +c,d @@` header rather than from
 * counting rows: a hunk may start anywhere in the file and may omit a count
 * (meaning one). Anything outside a hunk is file metadata (`diff --git`,
 * `---`/`+++`, modes, rename lines, the binary marker) and becomes a header
 * row; `index ...` is the one line dropped because its hashes only add noise.
 *
 * Malformed input must never throw: a git version, a truncated capture, or a
 * combined merge diff can all produce lines this parser does not understand,
 * and the TUI must show what is left instead of crashing.
 */
export const parseUnifiedDiff = (text: string): DiffLine[] => {
	const lines: DiffLine[] = [];
	let oldNumber = 0;
	let newNumber = 0;
	let inHunk = false;

	for (const raw of text.split('\n')) {
		const line = stripCarriageReturn(raw);

		if (inHunk) {
			const prefix = line[0];

			if (prefix === '+') {
				lines.push({
					kind: 'add',
					oldNumber: undefined,
					newNumber,
					text: line.slice(1),
				});
				newNumber += 1;
				continue;
			}

			if (prefix === '-') {
				lines.push({
					kind: 'del',
					oldNumber,
					newNumber: undefined,
					text: line.slice(1),
				});
				oldNumber += 1;
				continue;
			}

			if (prefix === ' ') {
				lines.push({
					kind: 'context',
					oldNumber,
					newNumber,
					text: line.slice(1),
				});
				oldNumber += 1;
				newNumber += 1;
				continue;
			}

			// `\ No newline at end of file` belongs to the hunk but moves no
			// counters; it is metadata, so it reads as a header row.
			if (prefix === '\\') {
				lines.push(headerLine(line));
				continue;
			}

			// Any other line ends the hunk: it is either the next file's
			// metadata or a separator. Fall through to the header handling.
			inHunk = false;
		}

		if (line.startsWith('@@')) {
			const match = hunkPattern.exec(line);

			if (match !== null) {
				// Omitted counts default to one, which is what git means by them.
				oldNumber = Number.parseInt(match[1] ?? '0', 10);
				newNumber = Number.parseInt(match[3] ?? '0', 10);
				inHunk = true;
			}

			lines.push(headerLine(line));
			continue;
		}

		if (line.startsWith('index ')) {
			continue;
		}

		// Empty lines are the trailing newline or a separator between files;
		// they carry no line numbers and are not worth a row.
		if (line.length === 0) {
			continue;
		}

		lines.push(headerLine(line));
	}

	return lines;
};

const statOf = (
	additions: string | undefined,
	deletions: string | undefined,
): DiffStat => {
	if (additions === '-' || deletions === '-') {
		return { additions: 0, deletions: 0, binary: true };
	}

	const add = Number.parseInt(additions ?? '', 10);
	const del = Number.parseInt(deletions ?? '', 10);

	return {
		additions: Number.isFinite(add) ? add : 0,
		deletions: Number.isFinite(del) ? del : 0,
		binary: false,
	};
};

/**
 * Parse `git diff --numstat -z` records.
 *
 * A normal record is `add<TAB>del<TAB>path<NUL>`. Rename detection changes the
 * path field to an empty token followed by the source and destination paths as
 * separate NUL tokens; the destination is what the status row names, so it is
 * the key here. `-` counts mean git calls the content binary.
 */
export const parseNumstat = (
	stdout: string | Buffer,
): ReadonlyMap<string, DiffStat> => {
	const text = typeof stdout === 'string' ? stdout : stdout.toString('utf8');
	const tokens = text.split('\0');
	const stats = new Map<string, DiffStat>();
	let cursor = 0;

	while (cursor < tokens.length) {
		const record = tokens[cursor];
		cursor += 1;

		if (record === undefined || record.length === 0) {
			continue;
		}

		// Paths may contain tabs, so split only the two leading fields. With
		// `-z` those tabs are real separators and the rest is the path.
		const first = record.indexOf('\t');
		const second = first === -1 ? -1 : record.indexOf('\t', first + 1);
		const additions = first === -1 ? '' : record.slice(0, first);
		const deletions = second === -1 ? '' : record.slice(first + 1, second);
		const path = second === -1 ? '' : record.slice(second + 1);

		if (path === '') {
			// Rename record: the empty path token is followed by `from` and `to`.
			cursor += 1;
			const to = tokens[cursor];
			cursor += 1;

			if (to !== undefined && to.length > 0) {
				stats.set(to, statOf(additions, deletions));
			}

			continue;
		}

		stats.set(path, statOf(additions, deletions));
	}

	return stats;
};

const readNumstat = async (
	cwd: string,
	options: { readonly staged: boolean },
): Promise<ReadonlyMap<string, DiffStat>> => {
	const args = options.staged
		? ['diff', '--cached', '--numstat', '-z']
		: ['diff', '--numstat', '-z'];
	const { stdoutBytes } = await runGitReadOnly(args, { cwd });
	return parseNumstat(stdoutBytes);
};

/**
 * Read one no-index file's counts, best effort.
 *
 * The command names exactly one path, so taking the only parsed value is more
 * robust than a keyed lookup: no-index framing can prefix or rename the path
 * side (`dev/null` -> file), and a missed key would silently report zero while
 * the expanded diff shows additions. Untracked and conflicted rows both use it:
 * neither has an index entry to compare against.
 */
const readNoIndexStat = async (
	cwd: string,
	file: WorkingFile,
): Promise<readonly [string, DiffStat]> => {
	try {
		const { stdoutBytes } = await runGitReadOnly(
			['diff', '--no-index', '--numstat', '-z', '--', nullDevice, file.path],
			// A difference is the expected outcome, not a failure.
			{ cwd, allowExitCodes: [0, 1] },
		);
		const parsed = parseNumstat(stdoutBytes);
		return [file.path, [...parsed.values()][0] ?? emptyStat];
	} catch {
		// The file may have vanished since status; the row still renders
		// with zero counts instead of taking the whole load down.
		return [file.path, emptyStat];
	}
};

/**
 * Read additions/deletions for every row in one status snapshot.
 *
 * Tracked rows come from two repository-wide numstat runs, and a row picks the
 * side its diff will show (staged rows the cached side, everything else the
 * worktree side). Untracked and conflicted files have no usable index entry, so
 * each is compared against the null device; that is per file because git's
 * no-index mode takes exactly two paths, and it is best effort because one file
 * vanishing between the status read and this call must not fail the whole
 * panel. Directory rows are skipped: `diff --no-index` has no defined meaning
 * for a directory.
 */
export const readWorkingFileStats = async (options: {
	readonly cwd: string;
	readonly files: readonly WorkingFile[];
}): Promise<ReadonlyMap<string, DiffStat>> => {
	const { cwd, files } = options;
	const stats = new Map<string, DiffStat>();

	for (const file of files) {
		stats.set(file.path, emptyStat);
	}

	const needsUnstaged = files.some(file => diffSourceOf(file) === 'unstaged');
	const needsStaged = files.some(file => diffSourceOf(file) === 'staged');
	const noIndexFiles = files.filter(file => {
		const source = diffSourceOf(file);
		return source === 'untracked-file' || source === 'conflicted';
	});
	const filesByPath = new Map(files.map(file => [file.path, file]));

	const [unstaged, staged] = await Promise.all([
		needsUnstaged ? readNumstat(cwd, { staged: false }) : undefined,
		needsStaged ? readNumstat(cwd, { staged: true }) : undefined,
	]);

	for (const [path, stat] of unstaged ?? []) {
		const file = filesByPath.get(path);

		if (file !== undefined && diffSourceOf(file) === 'unstaged') {
			stats.set(path, stat);
		}
	}

	for (const [path, stat] of staged ?? []) {
		const file = filesByPath.get(path);

		if (file !== undefined && diffSourceOf(file) === 'staged') {
			stats.set(path, stat);
		}
	}

	const noIndexStats: Array<readonly [string, DiffStat]> = [];

	for (
		let index = 0;
		index < noIndexFiles.length;
		index += untrackedStatBatchSize
	) {
		const batch = noIndexFiles.slice(index, index + untrackedStatBatchSize);
		// eslint-disable-next-line no-await-in-loop -- one batch at a time bounds the spawn burst
		const results = await Promise.all(
			batch.map(async file => readNoIndexStat(cwd, file)),
		);
		noIndexStats.push(...results);
	}

	for (const [path, stat] of noIndexStats) {
		stats.set(path, stat);
	}

	return stats;
};

/**
 * The note shown for an untracked directory row.
 *
 * Git collapses an untracked directory to a single status row and offers no
 * diff for it, so the expanded view answers the next question instead: which
 * files are inside, and how many. The list is capped so a directory with
 * thousands of files cannot flood the panel; the count stays honest.
 */
const readDirectoryNote = async (
	cwd: string,
	path: string,
): Promise<readonly DiffLine[]> => {
	const { stdoutBytes } = await runGitReadOnly(
		['ls-files', '--others', '--exclude-standard', '-z', '--', path],
		{ cwd },
	);
	const paths = stdoutBytes
		.toString('utf8')
		.split('\0')
		.filter(entry => entry.length > 0);
	const label = `${paths.length} untracked file${
		paths.length === 1 ? '' : 's'
	}`;
	const lines: DiffLine[] = [headerLine(`directory ${path} - ${label}`)];

	for (const entry of paths.slice(0, directoryFileCap)) {
		lines.push(headerLine(`  ${entry}`));
	}

	if (paths.length > directoryFileCap) {
		lines.push(headerLine(`... and ${paths.length - directoryFileCap} more`));
	}

	return lines;
};

/**
 * Read and parse the diff for one working-tree row.
 *
 * Each source is a deliberate command choice, never a guess from the content:
 * staged rows read the index, untracked and conflicted files compare against
 * the null device, and everything else compares the worktree against the index.
 * A conflicted row shows the worktree file with its markers; the conflict note
 * above it makes that explicit, and only the file's own lines become additions
 * so git's no-index framing does not masquerade as conflict content. Paths
 * follow `--` so a name that looks like an option cannot change the command.
 */
export const readFileDiff = async (options: {
	readonly cwd: string;
	readonly file: WorkingFile;
}): Promise<readonly DiffLine[]> => {
	const { cwd, file } = options;

	switch (diffSourceOf(file)) {
		case 'untracked-directory': {
			return readDirectoryNote(cwd, file.path);
		}

		case 'untracked-file': {
			const { stdout } = await runGitReadOnly(
				['diff', '--no-index', '--', nullDevice, file.path],
				{ cwd, allowExitCodes: [0, 1] },
			);
			return withNoDiffNote(parseUnifiedDiff(stdout));
		}

		case 'conflicted': {
			const { stdout } = await runGitReadOnly(
				['diff', '--no-index', '--', nullDevice, file.path],
				{ cwd, allowExitCodes: [0, 1] },
			);
			// The worktree file is unresolved by definition: show it verbatim,
			// markers included, instead of pretending a side resolved it.
			return [
				headerLine('unresolved conflict - showing file with markers'),
				...parseUnifiedDiff(stdout).filter(line => line.kind === 'add'),
			];
		}

		case 'staged': {
			const { stdout } = await runGitReadOnly(
				['diff', '--cached', '--', file.path],
				{ cwd },
			);
			return withNoDiffNote(parseUnifiedDiff(stdout));
		}

		default: {
			const { stdout } = await runGitReadOnly(['diff', '--', file.path], {
				cwd,
			});
			return withNoDiffNote(parseUnifiedDiff(stdout));
		}
	}
};
