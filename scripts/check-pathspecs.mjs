#!/usr/bin/env node
/**
 * Focused regressions for literal pathspecs.
 *
 * Run after `npm run build`:
 *   node scripts/check-pathspecs.mjs
 *
 * The cases mirror the review findings: status paths are data, so a row named
 * `a*`, `glob-*.txt`, `question-?.txt`, `bracket-[1].txt`, or
 * `:(exclude)magic.txt` must name exactly that file for stage, unstage,
 * discard, clean, and diff. The decoys prove a leak: each one matches the row
 * under normal glob or magic rules. The hook case proves the flag is argv
 * policy, not an exported environment variable: a pre-commit hook running
 * `git diff --cached --name-only '*.ts'` must still see the added `.ts` file.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { runGit } from '../dist/git/exec.js';
import { readFileDiff } from '../dist/git/diff.js';
import {
	discardTracked,
	discardUntracked,
	stage,
	unstage,
} from '../dist/git/working-tree.js';

// A user shell that exports the old policy would make the hook assertion
// meaningless; the app's own behavior must not depend on this variable.
delete process.env.GIT_LITERAL_PATHSPECS;

const fixedDate = '2024-01-01T00:00:00 +0000';
const isolatedEnv = {
	...process.env,
	GIT_AUTHOR_DATE: fixedDate,
	GIT_COMMITTER_DATE: fixedDate,
	GIT_CONFIG_GLOBAL: devNull,
	GIT_CONFIG_NOSYSTEM: '1',
};

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

/** Rows whose names are patterns unless the pathspec is literal. */
const literalCases = [
	{ literal: 'a*', decoys: ['a1', 'ab'] },
	{ literal: 'glob-*.txt', decoys: ['glob-decoy.txt'] },
	{ literal: 'question-?.txt', decoys: ['question-a.txt'] },
	{ literal: 'bracket-[1].txt', decoys: ['bracket-1.txt'] },
	{ literal: ':(exclude)magic.txt', decoys: ['magic.txt'] },
];

const allTracked = literalCases.flatMap(({ literal, decoys }) => [
	literal,
	...decoys,
]);

const baseContent = name => `base ${name}\n`;
const changedContent = name => `base ${name}\nchanged ${name}\n`;

const root = mkdtempSync(path.join(tmpdir(), 'gitminal-pathspecs-'));
const repo = path.join(root, 'repo');

const git = args => {
	const [first, ...rest] = args;
	const common = [
		'-c',
		'user.name=gitminal pathspec check',
		'-c',
		'user.email=pathspec@gitminal.test',
		'-c',
		'commit.gpgsign=false',
		'-c',
		'init.defaultBranch=main',
	];

	return execFileSync('git', [...common, first, ...rest], {
		cwd: repo,
		env: isolatedEnv,
		stdio: ['ignore', 'pipe', 'pipe'],
		encoding: 'utf8',
	});
};

const cachedPaths = () =>
	git(['diff', '--cached', '--name-only', '-z'])
		.split('\0')
		.filter(entry => entry.length > 0)
		.sort();

const writeAll = contentOf => {
	for (const name of allTracked) {
		writeFileSync(path.join(repo, name), contentOf(name));
	}
};

const workingFile = (name, staged) => ({
	path: name,
	status: 'modified',
	staged,
	hasUnstaged: !staged,
	additions: 1,
	deletions: 0,
	binary: false,
	diff: [],
});

const run = async () => {
	mkdirSync(repo, { recursive: true });
	git(['init', '-q']);
	git(['config', 'user.name', 'gitminal pathspec check']);
	git(['config', 'user.email', 'pathspec@gitminal.test']);
	git(['config', 'commit.gpgsign', 'false']);

	writeAll(baseContent);
	git(['add', '-A']);
	git(['commit', '-q', '-m', 'base commit']);

	// Stage isolation: only the literal row enters the index.
	writeAll(changedContent);

	for (const { literal } of literalCases) {
		git(['reset', '-q']);
		// eslint-disable-next-line no-await-in-loop -- one assertion at a time keeps the failure readable
		await stage({ cwd: repo, paths: [literal] });
		check(`stage ${literal}`, cachedPaths(), [literal]);
	}

	// Unstage isolation: only the literal row leaves an otherwise full index.
	for (const { literal, decoys } of literalCases) {
		git(['reset', '-q']);
		git(['add', '-A']);
		// eslint-disable-next-line no-await-in-loop -- see above
		await unstage({ cwd: repo, paths: [literal] });
		const remaining = cachedPaths();
		assert.equal(
			remaining.includes(literal),
			false,
			`unstage ${literal} left the literal row staged`,
		);
		for (const decoy of decoys) {
			assert.equal(
				remaining.includes(decoy),
				true,
				`unstage ${literal} also unstaged the decoy ${decoy}`,
			);
		}

		process.stdout.write(`ok unstage ${literal} leaves its decoys staged\n`);
	}

	// Discard isolation: only the literal row is restored from the index.
	for (const { literal, decoys } of literalCases) {
		git(['reset', '-q']);
		writeAll(changedContent);
		// eslint-disable-next-line no-await-in-loop -- see above
		await discardTracked({ cwd: repo, paths: [literal] });
		check(
			`discard ${literal} restores the literal row`,
			readFileSync(path.join(repo, literal), 'utf8'),
			baseContent(literal),
		);

		for (const decoy of decoys) {
			check(
				`discard ${literal} leaves ${decoy} modified`,
				readFileSync(path.join(repo, decoy), 'utf8'),
				changedContent(decoy),
			);
		}
	}

	// Clean isolation: only the literal untracked row is removed.
	const untrackedCases = [
		{ literal: 'u-a*', decoy: 'u-a1' },
		{ literal: 'u-glob-*.txt', decoy: 'u-glob-decoy.txt' },
		{ literal: 'u-question-?.txt', decoy: 'u-question-a.txt' },
		{ literal: 'u-bracket-[1].txt', decoy: 'u-bracket-1.txt' },
		{ literal: ':(exclude)u-magic.txt', decoy: 'u-magic.txt' },
	];

	for (const { literal, decoy } of untrackedCases) {
		writeFileSync(path.join(repo, literal), `untracked ${literal}\n`);
		writeFileSync(path.join(repo, decoy), `untracked ${decoy}\n`);
		// eslint-disable-next-line no-await-in-loop -- see above
		await discardUntracked({ cwd: repo, paths: [literal] });
		check(
			`clean ${literal} removes the literal row`,
			existsSync(path.join(repo, literal)),
			false,
		);
		check(
			`clean ${literal} leaves ${decoy}`,
			existsSync(path.join(repo, decoy)),
			true,
		);
		rmSync(path.join(repo, decoy), { force: true });
	}

	// Diff isolation: the staged read shows only the literal row's content.
	for (const { literal, decoys } of literalCases) {
		git(['reset', '-q']);
		writeAll(changedContent);
		// eslint-disable-next-line no-await-in-loop -- see above
		await stage({ cwd: repo, paths: [literal] });
		// eslint-disable-next-line no-await-in-loop -- see above
		const lines = await readFileDiff({
			cwd: repo,
			file: workingFile(literal, true),
		});
		const text = lines.map(line => line.text).join('\n');

		assert.equal(
			text.includes(`changed ${literal}`),
			true,
			`diff ${literal} does not show the literal row`,
		);
		for (const decoy of decoys) {
			assert.equal(
				text.includes(`changed ${decoy}`),
				false,
				`diff ${literal} also shows the decoy ${decoy}`,
			);
		}

		process.stdout.write(`ok diff ${literal} excludes its decoys\n`);
	}

	// The flag is argv-only: a hook keeps normal glob pathspec behavior.
	git(['reset', '-q']);
	git(['clean', '-fdq']);
	const hookPath = path.join(repo, '.git', 'hooks', 'pre-commit');
	writeFileSync(
		hookPath,
		"#!/bin/sh\ngit diff --cached --name-only '*.ts' > .git/hook-observed\n",
	);
	chmodSync(hookPath, 0o755);
	git(['config', 'core.hooksPath', '.git/hooks']);

	writeFileSync(path.join(repo, 'added.ts'), 'export const probe = true;\n');
	git(['add', '--', 'added.ts']);
	await runGit(['commit', '-q', '-m', 'hook probe'], { cwd: repo });
	const observed = readFileSync(
		path.join(repo, '.git', 'hook-observed'),
		'utf8',
	);
	assert.equal(
		observed.includes('added.ts'),
		true,
		'the pre-commit hook did not see the staged .ts file; GIT_LITERAL_PATHSPECS leaked into its environment',
	);
	process.stdout.write('ok hook keeps normal glob pathspec behavior\n');
};

try {
	await run();
	process.stdout.write('pathspec regressions passed\n');
} finally {
	rmSync(root, { recursive: true, force: true });
}
