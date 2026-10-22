import { Buffer } from 'node:buffer';
import { stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import type { DiffLine, WorkingFile } from '../data/types.js';
import {
	capStoredOutput,
	GitError,
	runGitReadOnly,
	truncationMarkerPrefix,
} from './exec.js';
import { isDirectoryRow } from './working-tree.js';

/** Where a row's diff comes from; it also decides the cache signature. */
export type DiffSource =
	| 'staged'
	| 'unstaged'
	| 'untracked-file'
	| 'untracked-directory'
	| 'conflicted';

/** Additions/deletions for one row, plus markers numstat cannot express. */
export type DiffStat = {
	readonly additions: number;
	readonly deletions: number;
	readonly binary: boolean;
	/**
	 * True when the raw diff shows different file modes. Optional because the
	 * numstat parser cannot see modes; `readWorkingFileStats` fills it in after
	 * a second, targeted raw read.
	 */
	readonly modeChange?: boolean;
	/**
	 * The blob oid on the staged side, from `git diff --cached --raw -z`.
	 * Optional because only staged rows have one. Two equal numstat counts can
	 * hide a rewritten staged blob, so this token makes such a background
	 * `git add` invalidate the cached diff.
	 */
	readonly indexOid?: string;
};

const emptyStat: DiffStat = { additions: 0, deletions: 0, binary: false };

/** Path used as the "before" side of an untracked file's diff. */
const nullDevice = process.platform === 'win32' ? 'NUL' : os.devNull;

/** Files listed under an untracked directory before the note is capped. */
const directoryFileCap = 20;

/** Display rows kept for one expanded diff. */
const diffLineCap = 2000;

/** Raw diff bytes parsed before the row cap applies. */
const diffByteCap = 256 * 1024;

/** Untracked and conflicted files above this size are not diffed at all. */
const diffFileSizeCap = 1024 * 1024;

/** Human-readable size for notes, with no trailing `.0` on whole sizes. */
const formatSize = (bytes: number): string => {
	const scaled = (value: number, unit: string): string => {
		const rounded = Math.round(value * 10) / 10;
		const text = Number.isInteger(rounded)
			? String(rounded)
			: rounded.toFixed(1);
		return `${text} ${unit}`;
	};

	if (bytes >= 1024 * 1024) {
		return scaled(bytes / (1024 * 1024), 'MB');
	}

	if (bytes >= 1024) {
		return scaled(bytes / 1024, 'KB');
	}

	return `${bytes} B`;
};

/**
 * The note shown when either diff cap stopped the parse.
 *
 * Both limits are rendered from their constants, so changing a cap cannot
 * leave the note claiming an old one.
 */
const diffTruncationNote = `... diff truncated: showing first ${diffLineCap} lines / ${formatSize(
	diffByteCap,
)} ...`;

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
 * A binary row with no metadata says so honestly rather than claiming there
 * was no textual change.
 */
const withNoDiffNote = (
	lines: readonly DiffLine[],
	binary = false,
): readonly DiffLine[] =>
	lines.length > 0
		? lines
		: [headerLine(binary ? 'binary files differ' : 'no textual diff')];

/** Strip only the trailing CR so CRLF output parses like LF output. */
const stripCarriageReturn = (line: string): string =>
	line.endsWith('\r') ? line.slice(0, -1) : line;

/**
 * Cut raw diff text at a byte cap without splitting a line.
 *
 * Git emits huge diffs for generated files and minified bundles. Parsing the
 * whole capture before capping the rows would still pay the split and parse
 * cost, so the bytes are capped first. The final newline boundary keeps the
 * last kept line whole; a byte cut can otherwise leave a partial multibyte
 * character, which is dropped with the trailing replacement character.
 */
const truncateDiffText = (
	text: string,
	maxBytes: number,
): { readonly text: string; readonly truncated: boolean } => {
	if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
		return { text, truncated: false };
	}

	let capped = Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8');
	if (capped.endsWith('\uFFFD')) {
		capped = capped.slice(0, -1);
	}

	const boundary = capped.lastIndexOf('\n');
	return {
		text: boundary === -1 ? capped : capped.slice(0, boundary),
		truncated: true,
	};
};

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

/**
 * Parse a diff under both caps, ending with an explicit truncation header.
 *
 * The byte cap runs before parsing; the line cap then bounds the display
 * rows. Whichever cap was hit, the expanded view says so instead of silently
 * presenting a partial diff as complete.
 */
const parseDiffLines = (text: string): DiffLine[] => {
	const capped = truncateDiffText(text, diffByteCap);
	const lines = parseUnifiedDiff(capped.text);

	if (lines.length > diffLineCap) {
		return [...lines.slice(0, diffLineCap), headerLine(diffTruncationNote)];
	}

	return capped.truncated ? [...lines, headerLine(diffTruncationNote)] : lines;
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
	// Rename detection keeps one row per moved file, matching the status row
	// and the rename-aware diff read.
	const args = options.staged
		? ['diff', '--cached', '-M', '--numstat', '-z']
		: ['diff', '-M', '--numstat', '-z'];
	const result = await runGitReadOnly(args, { cwd });

	/*
	 * Fail closed on a truncated capture. The marker exists only on the decoded
	 * `stdout`; `stdoutBytes` is a hard-capped prefix that can end mid-record,
	 * so parsing it would silently drop rows or invent counts for a path whose
	 * record was cut. File counts are what the panel renders and what the diff
	 * signature uses, so a partial map is worse than an explicit failure.
	 */
	if (result.stdout.includes(truncationMarkerPrefix)) {
		const message =
			'git diff --numstat output was truncated; file change counts cannot be read safely';

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

	return parseNumstat(result.stdoutBytes);
};

/**
 * One `git diff --raw -z` record.
 *
 * The stream is `:oldmode newmode oldoid newoid status<NUL>path<NUL>`.
 * Rename and copy records carry two path tokens (source then destination), so
 * the destination is the row path that status also names. The read asks for
 * full object names (`--no-abbrev`), which keeps `newoid` a stable cache token
 * instead of a display abbreviation that can grow with the repository.
 */
export type RawDiffRecord = {
	readonly path: string;
	readonly oldMode: string;
	readonly newMode: string;
	readonly newOid: string;
	readonly status: string;
};

/**
 * Parse `git diff --raw -z` records.
 *
 * Both readers below need the same framing: mode detection compares the mode
 * pair, and staged rows take `newoid` as their `indexOid` token. Parsing once
 * keeps the two from drifting apart on rename/copy token counts.
 */
export const parseRawDiff = (
	stdout: string | Buffer,
): readonly RawDiffRecord[] => {
	const text = typeof stdout === 'string' ? stdout : stdout.toString('utf8');
	const tokens = text.split('\0');
	const records: RawDiffRecord[] = [];
	let cursor = 0;

	while (cursor < tokens.length) {
		const record = tokens[cursor];
		cursor += 1;

		if (record === undefined || !record.startsWith(':')) {
			continue;
		}

		const fields = record.slice(1).split(' ');
		const oldMode = fields[0] ?? '';
		const newMode = fields[1] ?? '';
		const newOid = fields[3] ?? '';
		const status = fields[4] ?? '';
		const isRename = status.startsWith('R') || status.startsWith('C');
		const path = isRename ? tokens[cursor + 1] ?? '' : tokens[cursor] ?? '';
		cursor += isRename ? 2 : 1;

		records.push({ path, oldMode, newMode, newOid, status });
	}

	return records;
};

/**
 * Whether a raw record carries a mode-only or type change.
 *
 * Only `M` and `T` records are relevant: mode-only changes show up as `M`
 * with equal oids, while renames already have their own row and diff. Every
 * mode pair is compared even when the content also changed; the row chip
 * ignores the marker unless there are no counts.
 */
const isModeChangeRecord = (record: RawDiffRecord): boolean =>
	(record.status === 'M' || record.status === 'T') &&
	record.oldMode !== record.newMode;

/**
 * Paths whose raw record shows a mode-only or type change. Kept as a pure
 * parser beside `parseRawDiff` so both derived readings share one framing.
 */
export const parseRawModeChanges = (
	stdout: string | Buffer,
): ReadonlySet<string> => {
	const paths = new Set<string>();

	for (const record of parseRawDiff(stdout)) {
		if (isModeChangeRecord(record) && record.path.length > 0) {
			paths.add(record.path);
		}
	}

	return paths;
};

const readRawDiff = async (
	cwd: string,
	options: { readonly staged: boolean },
): Promise<readonly RawDiffRecord[]> => {
	const args = options.staged
		? ['diff', '--cached', '--raw', '--no-abbrev', '-z']
		: ['diff', '--raw', '--no-abbrev', '-z'];
	const { stdoutBytes } = await runGitReadOnly(args, { cwd });
	return parseRawDiff(stdoutBytes);
};

/**
 * A best-effort raw read: a failure leaves the affected rows without the
 * marker or token instead of failing the stats the panel needs.
 */
const readRawDiffBestEffort = async (
	cwd: string,
	options: { readonly staged: boolean },
): Promise<readonly RawDiffRecord[] | undefined> => {
	try {
		return await readRawDiff(cwd, options);
	} catch {
		return undefined;
	}
};

/**
 * Read one no-index file's counts, best effort.
 *
 * The command names exactly one path, so taking the only parsed value is more
 * robust than a keyed lookup: no-index framing can prefix or rename the path
 * side (`dev/null` -> file), and a missed key would silently report zero while
 * the expanded diff shows additions. Untracked and conflicted rows both use it:
 * neither has an index entry to compare against.
 *
 * The path is stat-tested first because the expanded diff skips a missing,
 * non-regular, or above-cap file with its own note, so spawning git for those
 * rows would only pay for a read whose counts cannot be shown. Their rows keep
 * zero counts, and a normal file keeps the best-effort no-index read.
 */
const readNoIndexStat = async (
	cwd: string,
	file: WorkingFile,
): Promise<readonly [string, DiffStat]> => {
	try {
		const info = await stat(path.join(cwd, file.path));

		if (!info.isFile() || info.size > diffFileSizeCap) {
			return [file.path, emptyStat];
		}
	} catch {
		return [file.path, emptyStat];
	}

	try {
		const result = await runGitReadOnly(
			['diff', '--no-index', '--numstat', '-z', '--', nullDevice, file.path],
			// A difference is the expected outcome, not a failure.
			{ cwd, allowExitCodes: [0, 1], literalPathspecs: true },
		);

		// A truncated capture can end mid-record; reporting zero counts is
		// honest, while parsing the partial map could attribute a count to the
		// wrong path.
		if (result.stdout.includes(truncationMarkerPrefix)) {
			return [file.path, emptyStat];
		}

		const parsed = parseNumstat(result.stdoutBytes);
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
 *
 * Numstat cannot express a mode-only change: it prints `0<TAB>0<TAB>path`, the
 * same counts as a content change with no lines. A raw read is run for the
 * unstaged side only when at least one tracked modified/typechange row looks
 * like that. The staged side always gets one when it has rows, because
 * `newoid` is the index content token: two different staged blobs with equal
 * counts must not share a cached diff. Both raw reads are best effort so a
 * failure never fails the stats the panel needs.
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

	const isModeCandidate = (file: WorkingFile): boolean => {
		const stat = stats.get(file.path);
		return (
			stat !== undefined &&
			stat.additions === 0 &&
			stat.deletions === 0 &&
			!stat.binary &&
			(file.status === 'modified' || file.status === 'typechange')
		);
	};

	const needsUnstagedModes =
		needsUnstaged &&
		files.some(
			file => diffSourceOf(file) === 'unstaged' && isModeCandidate(file),
		);

	const [unstagedRaw, stagedRaw] = await Promise.all([
		needsUnstagedModes
			? readRawDiffBestEffort(cwd, { staged: false })
			: undefined,
		needsStaged ? readRawDiffBestEffort(cwd, { staged: true }) : undefined,
	]);

	const applyRawRecords = (
		records: readonly RawDiffRecord[] | undefined,
		source: DiffSource,
	): void => {
		for (const record of records ?? []) {
			const file = filesByPath.get(record.path);
			const stat = stats.get(record.path);

			if (
				file === undefined ||
				stat === undefined ||
				record.path.length === 0 ||
				diffSourceOf(file) !== source
			) {
				continue;
			}

			const changesMode = isModeChangeRecord(record) && isModeCandidate(file);
			const indexOid =
				source === 'staged' && record.newOid.length > 0
					? record.newOid
					: undefined;

			if (indexOid === undefined && !changesMode) {
				continue;
			}

			stats.set(record.path, {
				...stat,
				...(indexOid === undefined ? {} : { indexOid }),
				...(changesMode ? { modeChange: true } : {}),
			});
		}
	};

	applyRawRecords(stagedRaw, 'staged');
	applyRawRecords(unstagedRaw, 'unstaged');

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
 * thousands of files cannot flood the panel. A capture that hit the byte cap
 * cannot be counted: it stops mid-list, so the header says the listing is
 * truncated and the remainder row is omitted rather than claiming an exact
 * count.
 */
const readDirectoryNote = async (
	cwd: string,
	path: string,
): Promise<readonly DiffLine[]> => {
	const result = await runGitReadOnly(
		['ls-files', '--others', '--exclude-standard', '-z', '--', path],
		{ cwd, literalPathspecs: true },
	);
	const isTruncated = result.stdout.includes(truncationMarkerPrefix);
	const paths = result.stdoutBytes
		.toString('utf8')
		.split('\0')
		.filter(entry => entry.length > 0);
	const label = isTruncated
		? '... directory listing truncated ...'
		: `${paths.length} untracked file${paths.length === 1 ? '' : 's'}`;
	const lines: DiffLine[] = [headerLine(`directory ${path} - ${label}`)];

	for (const entry of paths.slice(0, directoryFileCap)) {
		lines.push(headerLine(`  ${entry}`));
	}

	if (!isTruncated && paths.length > directoryFileCap) {
		lines.push(headerLine(`... and ${paths.length - directoryFileCap} more`));
	}

	return lines;
};

/**
 * Refuse to diff a file git cannot compare cheaply.
 *
 * Untracked and conflicted rows have no index side, so their diff reads the
 * whole worktree file. A directory or a missing path would make git fail; a
 * large file would flood the capture and the screen for no useful detail, so
 * both become one honest header row instead of an error or a silent omission.
 */
const sizeGuardFor = async (
	cwd: string,
	file: WorkingFile,
): Promise<readonly DiffLine[] | undefined> => {
	try {
		const info = await stat(path.join(cwd, file.path));

		if (!info.isFile()) {
			return [headerLine(`${file.path} is not a regular file; diff skipped`)];
		}

		if (info.size > diffFileSizeCap) {
			return [
				headerLine(
					`file is ${formatSize(info.size)}; diff skipped (limit ${formatSize(
						diffFileSizeCap,
					)})`,
				),
			];
		}
	} catch {
		return [headerLine('file is missing; diff unavailable')];
	}

	return undefined;
};

/**
 * Pathspecs that let git recognize a rename.
 *
 * The destination alone makes `git diff -M` see a new file: the source is not
 * in the comparison, so no rename pair can form. Naming both sides produces
 * the real `rename from`/`rename to` metadata while still scoping the read to
 * the one row.
 */
const trackedPathspecs = (file: WorkingFile): readonly string[] =>
	file.from === undefined || file.from.length === 0
		? [file.path]
		: [file.from, file.path];

/**
 * Read and parse the diff for one working-tree row.
 *
 * Each source is a deliberate command choice, never a guess from the content:
 * staged rows read the index, untracked and conflicted files compare against
 * the null device, and everything else compares the worktree against the index.
 * Tracked reads enable rename detection and name both sides of a rename, so
 * git emits a real rename diff instead of a new-file diff for the destination.
 * A conflicted row shows the worktree file with its markers; the conflict note
 * above it makes that explicit, and only the file's own lines become additions
 * so git's no-index framing does not masquerade as conflict content. Paths
 * follow `--` so a name that looks like an option cannot change the command.
 * Every textual read is capped by bytes and rows, with a visible note when a
 * cap was hit; files without an index side are also size-checked first.
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
			const note = await sizeGuardFor(cwd, file);
			if (note !== undefined) {
				return note;
			}

			const { stdout } = await runGitReadOnly(
				['diff', '--no-index', '--', nullDevice, file.path],
				{ cwd, allowExitCodes: [0, 1], literalPathspecs: true },
			);
			return withNoDiffNote(parseDiffLines(stdout), file.binary);
		}

		case 'conflicted': {
			const note = await sizeGuardFor(cwd, file);
			if (note !== undefined) {
				return note;
			}

			const { stdout } = await runGitReadOnly(
				['diff', '--no-index', '--', nullDevice, file.path],
				{ cwd, allowExitCodes: [0, 1], literalPathspecs: true },
			);
			// The worktree file is unresolved by definition: show it verbatim,
			// markers included, instead of pretending a side resolved it. The
			// truncation note survives the add-only filter so a capped file
			// never looks complete.
			const parsed = parseDiffLines(stdout);
			return [
				headerLine('unresolved conflict - showing file with markers'),
				...parsed.filter(
					line => line.kind === 'add' || line.text === diffTruncationNote,
				),
			];
		}

		case 'staged': {
			const { stdout } = await runGitReadOnly(
				['diff', '--cached', '-M', '--', ...trackedPathspecs(file)],
				{ cwd, literalPathspecs: true },
			);
			return withNoDiffNote(parseDiffLines(stdout), file.binary);
		}

		default: {
			const { stdout } = await runGitReadOnly(
				['diff', '-M', '--', ...trackedPathspecs(file)],
				{ cwd, literalPathspecs: true },
			);
			return withNoDiffNote(parseDiffLines(stdout), file.binary);
		}
	}
};
