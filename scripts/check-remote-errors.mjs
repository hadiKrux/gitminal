#!/usr/bin/env node
/**
 * Focused regressions for remote failure classification and captured output.
 *
 * Run after `npm run build`:
 *   node scripts/check-remote-errors.mjs
 *
 * The cases mirror the review findings: a CR-framed fatal line must survive
 * splitting, a 401 in a progress count or URL port must not win over the real
 * failure, the server-side update hook must be named, and a stale
 * force-with-lease rejection must get the fetch-first hint.
 */
import assert from 'node:assert/strict';
import process from 'node:process';
import { PassThrough } from 'node:stream';
import React from 'react';
import { Box, render } from 'ink';
import { GitError } from '../dist/git/exec.js';
import { failureSummary } from '../dist/git/errors.js';
import { splitOutputLines } from '../dist/data/format.js';
import ErrorOverlay from '../dist/components/error-overlay.js';

/** Build the kind of error a failed `git push` produces. */
const pushError = (stderr, args = ['push']) =>
	new GitError(
		{
			args: ['--no-pager', '-c', 'color.ui=false', ...args],
			exitCode: 1,
			stdout: '',
			stderr,
		},
		'git push failed',
	);

const check = (name, actual, expected) => {
	assert.equal(
		actual,
		expected,
		`${name}\n  expected: ${expected}\n  actual:   ${actual}`,
	);
	process.stdout.write(`ok ${name}: ${actual}\n`);
};

// B1: the CR update and the fatal line are separate physical lines, and the
// classification picks the fatal line instead of the merged progress text.
const framed =
	'Writing objects: 100% (5/5), done.\rfatal: the remote end hung up unexpectedly\n';
const framedLines = splitOutputLines(framed);
assert.deepEqual(
	framedLines.slice(0, 2),
	[
		'Writing objects: 100% (5/5), done.',
		'fatal: the remote end hung up unexpectedly',
	],
	'CR-framed output was not split before sanitizing',
);
assert.equal(
	framedLines.some(line => line.includes('done.fatal')),
	false,
	'progress and fatal lines are still merged',
);
check(
	'B1 failure summary',
	failureSummary(pushError(framed)),
	'fatal: the remote end hung up unexpectedly',
);
// The overlay receives the same stderr and renders every split line, so a
// blank stdout does not hide the fatal row.
const overlayLines = splitOutputLines(
	['', framed].filter(text => text.length > 0).join('\n'),
);
assert.equal(
	overlayLines.includes('fatal: the remote end hung up unexpectedly'),
	true,
	'overlay does not get the fatal line as its own row',
);
process.stdout.write('ok B1 overlay fatal row is separate\n');

// B2: 401 in a count must not override non-fast-forward, and port 401 in a
// URL must not override a network failure.
check(
	'B2 401 count keeps non-fast-forward',
	failureSummary(
		pushError(
			'Writing objects: 100% (401/401), done.\n! [rejected] main -> main (non-fast-forward)\nerror: failed to push some refs\n',
		),
	),
	'push rejected: non-fast-forward; pull first',
);
check(
	'B2 URL port 401 stays network',
	failureSummary(
		pushError(
			"fatal: unable to access 'http://127.0.0.1:401/repo.git/': Failed to connect to 127.0.0.1 port 401 after 0 ms: Connection refused\n",
		),
	),
	'network unreachable; check the remote URL and connection',
);
check(
	'B2 HTTP 401 remains auth',
	failureSummary(pushError('remote: HTTP 401 Unauthorized\n')),
	'authentication failed',
);
check(
	'B2 requested URL 401 remains auth',
	failureSummary(
		pushError(
			'fatal: unable to access the remote: The requested URL returned error: 401\n',
		),
	),
	'authentication failed',
);

// N3: the update hook never prints a hyphenated name.
check(
	'N3 update hook',
	failureSummary(
		pushError(
			'remote: update hook declined refs/heads/main\n! [remote rejected] main -> main (hook declined)\nerror: failed to push some refs\n',
		),
	),
	'update hook failed',
);

// N6: force-with-lease rejects a stale tracking ref with a fetch-first hint.
check(
	'N6 stale lease',
	failureSummary(
		pushError(
			'! [rejected] main -> main (stale info)\nerror: failed to push some refs\n',
		),
	),
	'push rejected: stale remote state; fetch first',
);

/**
 * Render the real overlay once and check the fatal line is its own row.
 *
 * The shared splitter is already asserted above; this proves the component
 * that consumes it also renders the rows separately. The fake stdin supplies
 * raw mode so `useInput` can mount outside an interactive terminal.
 */
const checkOverlayRender = async () => {
	const stdout = new PassThrough();
	stdout.columns = 100;
	stdout.rows = 40;
	const stdin = new PassThrough();
	stdin.isTTY = true;
	stdin.setRawMode = () => {};
	stdin.ref = () => {};
	stdin.unref = () => {};
	let captured = '';
	stdout.on('data', chunk => {
		captured += chunk;
	});

	const error = pushError(framed);
	const operation = {
		id: 1,
		kind: 'git',
		label: 'pushing',
		args: [error.args],
		startedAt: 0,
		endedAt: 1,
		status: 'failed',
		summary: failureSummary(error),
		error,
	};
	const instance = render(
		React.createElement(
			Box,
			{ width: 100, height: 40 },
			React.createElement(ErrorOverlay, { operation, onClose() {} }),
		),
		{ stdout, stdin, patchConsole: false },
	);
	await new Promise(resolve => {
		setTimeout(resolve, 200);
	});
	instance.unmount();
	await new Promise(resolve => {
		setTimeout(resolve, 30);
	});

	// Drop cursor-control sequences, then the escape codes themselves.
	const plain = captured
		.replaceAll('\u001B[2K', '')
		.replaceAll('\u001B[1A', '')
		.replaceAll('\u001B[G', '')
		.replaceAll('\u001B[2J', '')
		.replaceAll('\u001B[3J', '')
		.replaceAll('\u001B[H', '')
		// eslint-disable-next-line no-control-regex -- ANSI escapes are the point
		.replace(/\u001B\[[\d;?]*[ -/]*[@-~]/g, '');
	const rows = plain.split('\n');
	assert.equal(
		rows.some(row => row.includes('done.fatal')),
		false,
		'the rendered overlay merged the progress and fatal lines',
	);
	assert.equal(
		rows.some(
			row =>
				row.includes('fatal: the remote end hung') &&
				!row.includes('Writing objects'),
		),
		true,
		'the rendered overlay has no separate fatal row',
	);
	process.stdout.write('ok B1 overlay widget renders a separate fatal row\n');
};

await checkOverlayRender();

process.stdout.write('remote error regressions passed\n');
