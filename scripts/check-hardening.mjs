#!/usr/bin/env node
/**
 * Focused regressions for output-cap hardening.
 *
 * Run after `npm run build`:
 *   node scripts/check-hardening.mjs
 *
 * The cases mirror the review findings: retained error output keeps its head
 * and tail without a bogus "0 lines omitted" marker, a truncated log page
 * falls back to a header-only read so paging advances, a page that cannot fit
 * even one header fails instead of claiming more history, and a truncated
 * status read fails closed with a synthetic error instead of parsing a partial
 * stream. A temporary fake `git` on PATH supplies the oversized captures.
 */
import assert from 'node:assert/strict';
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { capStoredOutput, GitError } from '../dist/git/exec.js';
import { readLog } from '../dist/git/log.js';
import { readStatus } from '../dist/git/status.js';

const check = (name, actual, expected) => {
	assert.deepEqual(
		actual,
		expected,
		`${name}\n  expected: ${JSON.stringify(
			expected,
		)}\n  actual:   ${JSON.stringify(actual)}`,
	);
	process.stdout.write(`ok ${name}\n`);
};

// The head and the decisive tail of a long capture survive, with an explicit
// marker and no middle rows. A capture under the cap is returned untouched.
const headTail = Array.from(
	{ length: 1000 },
	(_, index) => `line ${index + 1}`,
).join('\n');
const capped = capStoredOutput(headTail);
assert.equal(capped.includes('line 1\n'), true, 'the head was dropped');
assert.equal(capped.endsWith('line 1000'), true, 'the tail was dropped');
assert.equal(
	capped.includes('lines omitted'),
	true,
	'the omitted-lines marker is missing',
);
assert.equal(
	capped.includes('\nline 500\n'),
	false,
	'a middle line survived the cap',
);
process.stdout.write('ok capStoredOutput keeps head and tail\n');
check(
	'capStoredOutput leaves a short capture unchanged',
	capStoredOutput('one\ntwo'),
	'one\ntwo',
);
assert.equal(
	capStoredOutput('one\ntwo').includes('0 lines omitted'),
	false,
	'a capture with nothing omitted still got a marker',
);
process.stdout.write('ok capStoredOutput has no zero-omitted marker\n');

const root = mkdtempSync(path.join(tmpdir(), 'gitminal-hardening-'));
const binDir = path.join(root, 'bin');
const invocationLog = path.join(root, 'invocations.log');
const fakeGit = path.join(binDir, 'git');
const originalPath = process.env.PATH;
const originalMode = process.env.FAKE_GIT_MODE;

const fakeGitSource = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const write = value => fs.writeSync(1, value);

if (process.env.FAKE_GIT_LOG) {
	fs.appendFileSync(process.env.FAKE_GIT_LOG, JSON.stringify(args) + '\\n');
}

const subcommand = args.find(argument => argument === 'status' || argument === 'log');

if (subcommand === 'status') {
	write(Buffer.alloc(11 * 1024 * 1024, 's'));
	process.exit(0);
}

if (subcommand === 'log') {
	if (args.includes('--numstat')) {
		write('\\x1e' + '0'.repeat(40) + '\\x1f\\x1fAuthor\\x1f2024-01-01T00:00:00+00:00\\x1fsubject\\x1f\\n');
		write(Buffer.alloc(11 * 1024 * 1024, 'x'));
		write('\\n');
		process.exit(0);
	}

	if (process.env.FAKE_GIT_MODE === 'no-progress') {
		process.exit(0);
	}

	for (let index = 1; index <= 3; index += 1) {
		write('\\x1e' + String(index).padStart(40, '0') + '\\x1f\\x1fAuthor\\x1f2024-01-01T00:00:00+00:00\\x1fcommit ' + index + '\\x1f\\n');
	}

	process.exit(0);
}

process.exit(0);
`;

/** Read the fake git's argv log, or an empty list when nothing ran yet. */
const invocations = () =>
	readFileSync(invocationLog, 'utf8')
		.split('\n')
		.filter(line => line.length > 0)
		.map(line => JSON.parse(line));

try {
	mkdirSync(binDir, { recursive: true });
	writeFileSync(fakeGit, fakeGitSource);
	chmodSync(fakeGit, 0o755);
	writeFileSync(invocationLog, '');
	process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ''}`;
	process.env.FAKE_GIT_LOG = invocationLog;
	delete process.env.FAKE_GIT_MODE;

	// A page whose numstat block alone exceeds the cap still advances: the
	// retry without --numstat returns header-only commits for the same window.
	const page = await readLog({ cwd: root });
	check('truncated log fallback returns a page', page.commits.length, 3);
	check('truncated log fallback has no extra row', page.hasMore, false);
	const logCalls = invocations().filter(args => args.includes('log'));
	check('truncated log fallback makes two reads', logCalls.length, 2);
	check(
		'the first read asks for numstat',
		logCalls[0]?.includes('--numstat'),
		true,
	);
	check(
		'the fallback read is header-only',
		logCalls[1]?.includes('--numstat'),
		false,
	);
	process.stdout.write('ok truncated log page advances through the fallback\n');

	// If even the header-only page cannot fit a commit, the read fails instead
	// of returning an empty page with hasMore true, which would wedge paging.
	writeFileSync(invocationLog, '');
	process.env.FAKE_GIT_MODE = 'no-progress';
	let logError;
	try {
		await readLog({ cwd: root });
	} catch (error) {
		logError = error;
	}

	assert.equal(logError instanceof GitError, true, 'readLog did not throw');
	assert.equal(logError?.args.length, 0, 'the synthetic log error has argv');
	assert.equal(
		logError?.exitCode,
		undefined,
		'the synthetic log error has a code',
	);
	assert.equal(
		logError?.message.includes('too large to read'),
		true,
		'the log error does not name the oversized page',
	);
	check('no-progress log page makes no third read', invocations().length, 2);
	process.stdout.write('ok no-progress log page fails closed\n');

	// A truncated status stream cannot be parsed partially: the read reports a
	// synthetic error with no command and no exit code, and a capped stdout.
	let statusError;
	try {
		await readStatus({ cwd: root });
	} catch (error) {
		statusError = error;
	}

	assert.equal(
		statusError instanceof GitError,
		true,
		'readStatus did not throw',
	);
	assert.equal(
		statusError?.args.length,
		0,
		'the synthetic status error has argv',
	);
	assert.equal(
		statusError?.exitCode,
		undefined,
		'the synthetic status error has a code',
	);
	assert.equal(
		statusError?.stderr.includes('truncated'),
		true,
		'the status error does not say it was truncated',
	);
	assert.equal(
		(statusError?.stdout.length ?? 0) < 1024 * 1024,
		true,
		'the synthetic status error kept the whole oversized capture',
	);
	process.stdout.write('ok truncated status fails closed\n');
} finally {
	if (originalPath === undefined) {
		delete process.env.PATH;
	} else {
		process.env.PATH = originalPath;
	}

	if (originalMode === undefined) {
		delete process.env.FAKE_GIT_MODE;
	} else {
		process.env.FAKE_GIT_MODE = originalMode;
	}

	delete process.env.FAKE_GIT_LOG;
	rmSync(root, { recursive: true, force: true });
}

process.stdout.write('hardening regressions passed\n');
