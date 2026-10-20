#!/usr/bin/env node
/**
 * Generate the disposable git repositories and parser fixtures that the
 * milestone verifications run against.
 *
 * Every git invocation goes through `execFileSync('git', ...)` with a fixed
 * identity and fixed commit dates on purpose: the generated history (commit
 * oids, tags, status output) must not depend on the machine's global git config
 * or on the wall clock. Re-running wipes and rebuilds the repositories this
 * script owns under the output directory, so `--dir` can point at any scratch
 * location, and a plain re-run always lands on exactly the same state.
 *
 * Usage: node scripts/make-scratch-repos.mjs [--dir <path>] [--big]
 */
import { execFileSync } from 'node:child_process';
import {
	chmodSync,
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { devNull } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const defaultOutputDir = join(repoRoot, 'scratch');
const fixturesDir = join(repoRoot, 'scripts', 'fixtures');

/** Port `scripts/fake-auth-server.mjs` listens on by default. */
const fakeAuthPort = 49_321;
/** A port nothing listens on, for the unreachable-remote scenario. */
const closedPort = 9;

const identity = {
	name: 'gitminal scratch',
	email: 'scratch@gitminal.test',
};

/** Fixed commit timestamps keep every generated history byte-for-byte stable. */
const fixedDate = '2024-01-01T00:00:00 +0000';

/**
 * The generator ignores the machine's git config entirely: a global
 * core.hooksPath, autocrlf, or gpg setting must not leak into the fixtures.
 * Every command below carries the identity it needs via `-c`.
 */
const gitEnv = {
	GIT_AUTHOR_DATE: fixedDate,
	GIT_COMMITTER_DATE: fixedDate,
	GIT_CONFIG_GLOBAL: devNull,
	GIT_CONFIG_NOSYSTEM: '1',
};

/** `-c` flags prepended to every command so nothing reads the global config. */
const identityArgs = [
	'-c',
	`user.name=${identity.name}`,
	'-c',
	`user.email=${identity.email}`,
	'-c',
	'commit.gpgsign=false',
	'-c',
	'init.defaultBranch=main',
];

const git = (cwd, args) =>
	execFileSync('git', [...identityArgs, ...args], {
		cwd,
		env: { ...process.env, ...gitEnv },
		stdio: ['ignore', 'pipe', 'pipe'],
		encoding: 'utf8',
	});

/** Like `git`, but keeps stdout as a Buffer for raw-byte fixtures. */
const gitBytes = (cwd, args) =>
	execFileSync('git', [...identityArgs, ...args], {
		cwd,
		env: { ...process.env, ...gitEnv },
		stdio: ['ignore', 'pipe', 'pipe'],
	});

/** Run git with stderr redirected straight to a file, CR/LF framing intact. */
const gitToFile = (cwd, args, filePath) => {
	const descriptor = openSync(filePath, 'w');

	try {
		execFileSync('git', [...identityArgs, ...args], {
			cwd,
			env: { ...process.env, ...gitEnv },
			stdio: ['ignore', 'ignore', descriptor],
		});
	} finally {
		closeSync(descriptor);
	}
};

/** Run a git command that is expected to fail; undefined means it succeeded. */
const gitFailing = (cwd, args) => {
	try {
		git(cwd, args);
	} catch (error) {
		if (error instanceof Error && 'status' in error) {
			return error.status;
		}

		throw error;
	}

	return undefined;
};

const assert = (condition, message) => {
	if (!condition) {
		throw new Error(message);
	}
};

/** The `# branch.ab +ahead -behind` line git prints for a branch. */
const branchAb = repo => {
	const status = git(repo, ['status', '--porcelain=v2', '--branch']);
	const line = status.split('\n').find(item => item.startsWith('# branch.ab '));

	assert(line !== undefined, `${repo} has no branch.ab header:\n${status}`);
	return line.trim();
};

const write = (root, path, content) => {
	const target = join(root, path);
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, content);
};

const append = (root, path, content) => {
	const target = join(root, path);
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, content, { flag: 'a' });
};

/** Install an executable hook; git runs it with `sh` on every invocation. */
const writeHook = (repo, name, content) => {
	const path = join(repo, '.git', 'hooks', name);
	writeFileSync(path, content);
	chmodSync(path, 0o755);

	// A global core.hooksPath (common in dotfile setups) would redirect hook
	// lookup away from .git/hooks; pin it locally so the scenario always fires.
	git(repo, ['config', 'core.hooksPath', '.git/hooks']);
};

const createBasic = outputDir => {
	const basic = join(outputDir, 'basic');
	const origin = join(outputDir, 'basic-origin.git');

	git(outputDir, ['init', 'basic']);
	git(outputDir, ['init', '--bare', 'basic-origin.git']);

	write(basic, 'README.md', '# basic scratch repo\n');
	write(basic, 'dirty.txt', 'tracked file that will be modified\n');
	write(basic, 'nested/deep/file.txt', 'nested tracked content\n');
	write(basic, 'src/main.txt', 'main branch content\n');
	git(basic, ['add', '-A']);
	git(basic, ['commit', '-m', 'initial commit']);
	git(basic, ['tag', 'v0.1.0']);

	git(basic, ['branch', 'feature']);
	write(basic, 'src/main.txt', 'main branch content\nsecond line\n');
	write(basic, 'src/main-extra.txt', 'extra main file\n');
	git(basic, ['add', '-A']);
	git(basic, ['commit', '-m', 'main work']);
	git(basic, ['tag', 'v0.2.0']);

	git(basic, ['switch', 'feature']);
	write(basic, 'src/feature.txt', 'feature branch file\n');
	git(basic, ['add', '-A']);
	git(basic, ['commit', '-m', 'feature work']);

	git(basic, ['switch', 'main']);
	write(basic, 'src/main-more.txt', 'more main work\n');
	git(basic, ['add', '-A']);
	git(basic, ['commit', '-m', 'more main work']);
	git(basic, ['merge', '--no-ff', '--no-edit', 'feature']);
	git(basic, ['tag', 'v1.0.0']);

	git(basic, ['remote', 'add', 'origin', '../basic-origin.git']);
	git(basic, ['push', '-u', 'origin', 'main']);
	git(basic, ['push', 'origin', 'feature', '--tags']);

	// The pending state the app must mirror: one dirty tracked file, one staged
	// file, one untracked file, one changed nested file, one untracked directory.
	append(basic, 'dirty.txt', 'uncommitted worktree change\n');
	write(basic, 'staged.txt', 'staged but not committed\n');
	git(basic, ['add', 'staged.txt']);
	append(basic, 'nested/deep/file.txt', 'nested uncommitted change\n');
	write(basic, 'untracked.txt', 'never added\n');
	write(basic, 'untracked-dir/one.txt', 'untracked directory file one\n');
	write(basic, 'untracked-dir/two.txt', 'untracked directory file two\n');

	const status = git(basic, ['status', '--porcelain']);

	for (const expected of [
		' M dirty.txt',
		' M nested/deep/file.txt',
		'A  staged.txt',
		'?? untracked.txt',
		'?? untracked-dir/',
	]) {
		assert(
			status.includes(`${expected}\n`),
			`basic/ status is missing: ${expected}\n${status}`,
		);
	}

	assert(existsSync(origin), 'basic-origin.git was not created');

	return {
		paths: [basic, origin],
		lines: [
			'git status: dirty/staged/untracked and nested pending changes plus the collapsed `? untracked-dir/` row.',
			'git log --oneline --graph --decorate: several commits including one merge; git branch -a: main and feature; git tag: v0.1.0, v0.2.0, v1.0.0.',
			'git remote -v: origin points at ../basic-origin.git (the bare clone next to this repo).',
			'node <repo>/dist/cli.js: badge `main`, the five pending paths with M/A/? letters, and "Working tree clean" nowhere.',
		],
	};
};

const createEmpty = outputDir => {
	const empty = join(outputDir, 'empty');
	git(outputDir, ['init', 'empty']);

	assert(
		gitFailing(empty, ['rev-parse', 'HEAD']) !== 0,
		'empty/ unexpectedly already has a commit',
	);

	return {
		paths: [empty],
		lines: [
			'no commits yet: git log fails and git status reports the unborn `main` branch with no files.',
			'node <repo>/dist/cli.js: `main` badge and "Working tree clean".',
		],
	};
};

const createConflicted = outputDir => {
	const conflicted = join(outputDir, 'conflicted');

	git(outputDir, ['init', 'conflicted']);
	write(conflicted, 'conflict.txt', 'line one\nline two\nline three\n');
	git(conflicted, ['add', '-A']);
	git(conflicted, ['commit', '-m', 'base commit']);

	git(conflicted, ['switch', '-c', 'other']);
	write(
		conflicted,
		'conflict.txt',
		'line one\nother branch change\nline three\n',
	);
	git(conflicted, ['commit', '-am', 'other branch change']);

	git(conflicted, ['switch', 'main']);
	write(
		conflicted,
		'conflict.txt',
		'line one\nmain branch change\nline three\n',
	);
	git(conflicted, ['commit', '-am', 'main branch change']);

	assert(
		gitFailing(conflicted, ['merge', '--no-edit', 'other']) === 1,
		'the merge in conflicted/ was expected to conflict',
	);

	const status = git(conflicted, ['status', '--porcelain=v2']);
	assert(
		status.includes('u UU ') && status.includes('conflict.txt'),
		`merge state is not UU:\n${status}`,
	);

	return {
		paths: [conflicted],
		lines: [
			'two branches edit the same line; the merge is left in progress with unmerged paths (`git status` shows UU).',
			'the app must load without crashing on it (conflict semantics land in milestone 10).',
		],
	};
};

const createDetached = outputDir => {
	const detached = join(outputDir, 'detached');

	git(outputDir, ['init', 'detached']);
	write(detached, 'history.txt', 'one\n');
	git(detached, ['add', '-A']);
	git(detached, ['commit', '-m', 'first commit']);
	append(detached, 'history.txt', 'two\n');
	git(detached, ['commit', '-am', 'second commit']);
	append(detached, 'history.txt', 'three\n');
	git(detached, ['commit', '-am', 'third commit']);
	git(detached, ['switch', '--detach', 'HEAD~1']);

	const status = git(detached, ['status', '--porcelain=v2', '--branch']);
	assert(
		status.includes('# branch.head (detached)'),
		`detached/ is not detached:\n${status}`,
	);

	return {
		paths: [detached],
		lines: [
			'HEAD is detached at the second commit; git status says "HEAD detached".',
			'node <repo>/dist/cli.js: badge reads `detached @ <sha>` with no crash.',
		],
	};
};

const createRemotePair = outputDir => {
	const origin = join(outputDir, 'remote-origin.git');
	const remote = join(outputDir, 'remote');
	const remoteOther = join(outputDir, 'remote-other');
	const remotePull = join(outputDir, 'remote-pull');
	const remoteStale = join(outputDir, 'remote-stale');
	const remoteClean = join(outputDir, 'remote-clean');

	git(outputDir, ['init', '--bare', 'remote-origin.git']);
	git(outputDir, ['init', 'remote']);
	write(remote, 'shared.txt', 'shared seed line\n');
	git(remote, ['add', '-A']);
	git(remote, ['commit', '-m', 'shared base commit']);
	git(remote, ['remote', 'add', 'origin', '../remote-origin.git']);
	git(remote, ['push', '-u', 'origin', 'main']);

	// Cloned before the other clone's commit on purpose: after the push and a
	// fetch it is exactly one behind, so pull has a real fast-forward to make.
	git(outputDir, ['clone', 'remote-origin.git', 'remote-pull']);
	// Cloned on the same stale base and never fetched, so its origin/main
	// tracking ref still points at the base after remote-other pushes.
	git(outputDir, ['clone', 'remote-origin.git', 'remote-stale']);
	git(outputDir, ['clone', 'remote-origin.git', 'remote-other']);

	append(remoteOther, 'shared.txt', 'pushed from remote-other first\n');
	git(remoteOther, ['commit', '-am', 'other clone change']);
	git(remoteOther, ['push', 'origin', 'main']);

	append(remoteStale, 'shared.txt', 'local change on the stale base\n');
	git(remoteStale, ['commit', '-am', 'stale local change']);
	assert(
		branchAb(remoteStale) === '# branch.ab +1 -0',
		`remote-stale/ is not ahead of its stale tracking ref: ${branchAb(
			remoteStale,
		)}`,
	);

	git(remotePull, ['fetch', 'origin']);
	assert(
		branchAb(remotePull) === '# branch.ab +0 -1',
		`remote-pull/ is not behind by one: ${branchAb(remotePull)}`,
	);

	// Remote/ fetches first so its tracking ref is current, then commits on
	// the stale base: the result is immediately ahead 1 and behind 1, and the
	// push is the non-fast-forward fixture without any manual setup.
	git(remote, ['fetch', 'origin']);
	append(remote, 'shared.txt', 'local change without a fetch\n');
	git(remote, ['commit', '-am', 'local clone change']);
	assert(
		branchAb(remote) === '# branch.ab +1 -1',
		`remote/ is not divergent: ${branchAb(remote)}`,
	);

	// Cloned from the final origin state, then given one local commit: push
	// succeeds and the ahead count drops to zero.
	git(outputDir, ['clone', 'remote-origin.git', 'remote-clean']);
	write(remoteClean, 'clean-local.txt', 'one local commit to push\n');
	git(remoteClean, ['add', '-A']);
	git(remoteClean, ['commit', '-m', 'clean local change']);
	assert(
		branchAb(remoteClean) === '# branch.ab +1 -0',
		`remote-clean/ is not one ahead: ${branchAb(remoteClean)}`,
	);

	assert(existsSync(origin), 'remote-origin.git was not created');

	return {
		paths: [remote, remoteOther, remotePull, remoteStale, remoteClean, origin],
		lines: [
			'remote/ is ahead 1 and behind 1 with a current origin/main tracking ref: a plain push is rejected as non-fast-forward, while an immediate --force-with-lease push succeeds and rewrites the remote.',
			"remote-stale/ is one local commit ahead of its stale origin/main tracking ref (+1 -0 seen locally): a plain push is rejected as non-fast-forward (`fetch first` in git's own output), and an immediate --force-with-lease push fails with `stale info` until a fetch refreshes the tracking ref.",
			'remote-clean/ is one local commit ahead of origin: push succeeds with progress and the ahead count drops to 0.',
			"remote-pull/ is behind by one after a fetch: pull fast-forwards in remote-other's non-conflicting commit.",
			'git fetch inside remote-pull/ or big-clone/ updates remote refs; the sidebar shows the new refs and counts after refresh.',
		],
	};
};

const createRemoteBadAuth = outputDir => {
	const repo = join(outputDir, 'remote-bad-auth');
	const url = `http://127.0.0.1:${fakeAuthPort}/repo.git`;

	git(outputDir, ['init', 'remote-bad-auth']);
	write(repo, 'README.md', '# bad auth scratch repo\n');
	git(repo, ['add', '-A']);
	git(repo, ['commit', '-m', 'initial commit']);
	git(repo, ['remote', 'add', 'origin', url]);

	assert(
		git(repo, ['remote', 'get-url', 'origin']).trim() === url,
		'remote-bad-auth/ origin does not point at the fake auth server',
	);

	return {
		paths: [repo],
		lines: [
			`origin points at ${url} (the fake auth server).`,
			'start `node scripts/fake-auth-server.mjs --mode=401` in a second terminal, then fetch with no credentials: GIT_TERMINAL_PROMPT=0 classifies it as `authentication required; terminal prompts disabled` (no prompt, no hang).',
			'set the origin URL to `http://bad:bad@127.0.0.1:49321/repo.git` for the supplied-but-wrong credential case (`authentication failed`).',
			'`--mode=stall` instead hangs the request so timeout handling can be verified.',
		],
	};
};

const createRemoteUnreachable = outputDir => {
	const repo = join(outputDir, 'remote-unreachable');
	const url = `http://127.0.0.1:${closedPort}/repo.git`;

	git(outputDir, ['init', 'remote-unreachable']);
	write(repo, 'README.md', '# unreachable scratch repo\n');
	git(repo, ['add', '-A']);
	git(repo, ['commit', '-m', 'initial commit']);
	git(repo, ['remote', 'add', 'origin', url]);

	return {
		paths: [repo],
		lines: [
			`origin points at ${url}, a closed local port.`,
			'any fetch or push must fail with a connection error (milestone 9).',
		],
	};
};

const createHooks = outputDir => {
	const repo = join(outputDir, 'hooks');

	git(outputDir, ['init', 'hooks']);
	write(repo, 'README.md', '# hooks scratch repo\n');
	git(repo, ['add', '-A']);
	git(repo, ['commit', '-m', 'initial commit']);
	writeHook(
		repo,
		'pre-commit',
		'#!/bin/sh\necho "pre-commit hook rejects this commit"\nexit 1\n',
	);

	assert(
		gitFailing(repo, ['commit', '--allow-empty', '-m', 'hook probe']) === 1,
		'the pre-commit hook was expected to fail the probe commit',
	);

	return {
		paths: [repo],
		lines: [
			'every commit fails in the executable pre-commit hook ("pre-commit hook rejects this commit").',
			'milestone 6 verifies the error overlay with its output; `git commit --no-verify` succeeds.',
		],
	};
};

const createSlow = outputDir => {
	const repo = join(outputDir, 'slow');

	git(outputDir, ['init', 'slow']);
	write(repo, 'README.md', '# slow scratch repo\n');
	git(repo, ['add', '-A']);
	git(repo, ['commit', '-m', 'initial commit']);
	writeHook(
		repo,
		'pre-commit',
		'#!/bin/sh\nsleep 2\necho "slow hook finished"\n',
	);

	return {
		paths: [repo],
		lines: [
			'every commit spends about 2 seconds inside the pre-commit hook and then succeeds.',
			'milestone 3 checks the live busy state with `git commit --allow-empty -m probe`.',
		],
	};
};

const createBig = outputDir => {
	const repo = join(outputDir, 'big');
	const fileCount = 20;
	const seed = index => `seed ${index}\n`;

	git(outputDir, ['init', '--bare', 'big-origin.git']);
	git(outputDir, ['init', 'big']);

	for (let index = 1; index <= fileCount; index += 1) {
		write(repo, `data/file-${index}.txt`, seed(index));
	}

	git(repo, ['add', '-A']);
	git(repo, ['commit', '-m', 'seed big repo']);

	const commit = index => {
		append(
			repo,
			`data/file-${(index % fileCount) + 1}.txt`,
			`change ${index}\n`,
		);
		append(repo, 'lore.txt', `lore ${index}\n`);
		git(repo, ['commit', '-am', `big commit ${index}`]);
	};

	for (let index = 1; index <= 100; index += 1) {
		commit(index);
	}

	git(repo, ['remote', 'add', 'origin', '../big-origin.git']);
	git(repo, ['push', '-u', 'origin', 'main']);

	// A second batch gives the captured `push --progress` stream enough objects
	// to report percentages; the framing (CR updates, phase lines) must survive.
	for (let index = 101; index <= 140; index += 1) {
		commit(index);
	}

	gitToFile(
		repo,
		['push', '--progress', 'origin', 'main'],
		join(fixturesDir, 'push-progress.log'),
	);

	// The clone exists at the fixture-push state. More commits stay local so
	// a live push in big/ transfers a batch and a fetch in big-clone/ has
	// objects to receive.
	git(outputDir, ['clone', 'big-origin.git', 'big-clone']);

	for (let index = 141; index <= 180; index += 1) {
		commit(index);
	}

	assert(
		branchAb(repo) === '# branch.ab +40 -0',
		`big/ does not end with unpushed commits: ${branchAb(repo)}`,
	);

	return {
		paths: [repo, join(outputDir, 'big-clone')],
		lines: [
			'stress repo: about 180 commits and 20 tracked files; the last 40 commits are unpushed so a live push transfers objects.',
			'a push in big/ shows Compressing/Writing objects percentages and then drops the ahead count to 0.',
			'fetching in big-clone/ receives that batch and shows Receiving objects.',
			`push progress was captured to ${join(
				fixturesDir,
				'push-progress.log',
			)} with its CR/LF framing.`,
		],
	};
};

/** Parse `--dir <path>` and `--big`; anything else is a usage error. */
const parseArgs = argv => {
	const options = { dir: defaultOutputDir, big: false };
	let index = 0;

	while (index < argv.length) {
		const arg = argv[index];
		index += 1;

		if (arg === '--big') {
			options.big = true;
			continue;
		}

		if (arg === '--dir') {
			const value = argv[index];

			if (value === undefined) {
				throw new Error('--dir needs a path');
			}

			index += 1;
			options.dir = resolve(value);
			continue;
		}

		throw new Error(`unknown argument: ${arg} (usage: --dir <path> [--big])`);
	}

	return options;
};

/** Wipe and recreate everything this script owns under `outputDir`. */
const resetOutput = outputDir => {
	const owned = [
		'basic',
		'basic-origin.git',
		'empty',
		'conflicted',
		'detached',
		'remote',
		'remote-other',
		'remote-pull',
		'remote-stale',
		'remote-clean',
		'remote-origin.git',
		'remote-bad-auth',
		'remote-unreachable',
		'hooks',
		'slow',
		'big',
		'big-clone',
		'big-origin.git',
	];

	mkdirSync(outputDir, { recursive: true });

	for (const name of owned) {
		rmSync(join(outputDir, name), { recursive: true, force: true });
	}

	rmSync(fixturesDir, { recursive: true, force: true });
	mkdirSync(fixturesDir, { recursive: true });
};

const writeFixtures = basic => {
	writeFileSync(
		join(fixturesDir, 'status-basic.bin'),
		gitBytes(basic, ['status', '--porcelain=v2', '--branch', '-z']),
	);
	writeFileSync(
		join(fixturesDir, 'log-numstat.txt'),
		git(basic, ['log', '--numstat', '--diff-merges=first-parent']),
	);
};

const main = () => {
	const options = parseArgs(process.argv.slice(2));
	const outputDir = options.dir;

	resetOutput(outputDir);

	const sections = [
		createBasic(outputDir),
		createEmpty(outputDir),
		createConflicted(outputDir),
		createDetached(outputDir),
		createRemotePair(outputDir),
		createRemoteBadAuth(outputDir),
		createRemoteUnreachable(outputDir),
		createHooks(outputDir),
		createSlow(outputDir),
	];

	if (options.big) {
		sections.push(createBig(outputDir));
	}

	writeFixtures(join(outputDir, 'basic'));

	process.stdout.write(`scratch repos ready in ${outputDir}\n\n`);

	for (const section of sections) {
		process.stdout.write(`${section.paths.join('\n')}\n`);

		for (const line of section.lines) {
			process.stdout.write(`  - ${line}\n`);
		}

		process.stdout.write('\n');
	}

	process.stdout.write(`parser fixtures in ${fixturesDir}\n`);
};

main();
