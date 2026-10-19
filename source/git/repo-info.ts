import path from 'node:path';
import { GitError, runGitReadOnly } from './exec.js';

/** Where the process was started, from git's point of view. */
export type RepoInfo =
	| {
			readonly kind: 'repo';
			readonly root: string;
			readonly gitDir: string;
			/**
			 * Shared git directory that holds the refs; in a linked worktree this
			 * differs from `gitDir`, which only holds that worktree's HEAD and
			 * index. Live sync watches this directory so branch, stash, and fetch
			 * updates are visible from every worktree.
			 */
			readonly commonDir: string;
	  }
	| { readonly kind: 'bare'; readonly gitDir: string }
	| { readonly kind: 'not-a-repo' };

export type Identity = {
	readonly name: string;
	readonly email: string;
	/**
	 * Present when user.name or user.email is unset; the UI shows this instead
	 * of an empty author line, and the commit would fail without it.
	 */
	readonly hint?: string;
};

export type RepoProbe = {
	readonly repo: RepoInfo;
	readonly identity: Identity;
};

/**
 * Shared identity setup hint.
 *
 * The commit box author line, the repo probe, and the failure classifier all
 * show the same sentence, so an unset identity cannot explain itself three
 * different ways.
 */
export const missingIdentityHint = 'set user.name and user.email to commit';

/** The one `rev-parse` failure that is a normal state rather than an error. */
const notInRepositoryMessage = 'not a git repository';

/**
 * Strip only the trailing newline of a `rev-parse` path answer.
 *
 * `trim()` must not be used here: a repository can live in a directory whose
 * name ends (or starts) with spaces, and trimming it would resolve to the wrong
 * `cwd` for every later command.
 */
const pathValue = (stdout: string): string => stdout.replace(/\r?\n+$/, '');

/** `git config` exits 1 for an unset key, which is a normal outcome here. */
const readConfigValue = async (cwd: string, key: string): Promise<string> => {
	const result = await runGitReadOnly(['config', key], {
		cwd,
		allowExitCodes: [0, 1],
	});

	return result.exitCode === 0 ? result.stdout.trim() : '';
};

/**
 * Read the identity at the resolved location, not the launch directory, so the
 * repository and its identity always come from one lookup: a nested launch, a
 * root launch, and a bare repo (which has no worktree root) cannot disagree
 * about which config is in effect.
 */
const readIdentity = async (cwd: string): Promise<Identity> => {
	const [name, email] = await Promise.all([
		readConfigValue(cwd, 'user.name'),
		readConfigValue(cwd, 'user.email'),
	]);

	if (name.length > 0 && email.length > 0) {
		return { name, email };
	}

	return { name, email, hint: missingIdentityHint };
};

/** The repo identity as one author line, falling back to the setup hint. */
export const identityLabel = (identity: Identity): string =>
	identity.hint ?? `${identity.name} <${identity.email}>`;

/**
 * Classify `cwd` as a worktree, a bare repository, or neither.
 *
 * Bare is detected first because bare repositories have no toplevel: asking for
 * `--show-toplevel` there fails for a reason that is not an error. `rev-parse`
 * exits 128 both for "not a git repository" and for real failures (dubious
 * ownership, a broken config); only the former is the not-a-repo state, and
 * everything else must surface as the thrown `GitError` so the UI shows the
 * actual detail instead of "not a git repository".
 */
export const resolveRepoInfo = async (options: {
	readonly cwd: string;
}): Promise<RepoProbe> => {
	const { cwd } = options;
	let isBare: boolean;

	try {
		const probe = await runGitReadOnly(['rev-parse', '--is-bare-repository'], {
			cwd,
		});
		isBare = probe.stdout.trim() === 'true';
	} catch (error: unknown) {
		if (
			error instanceof GitError &&
			error.stderr.includes(notInRepositoryMessage)
		) {
			return {
				repo: { kind: 'not-a-repo' },
				identity: await readIdentity(cwd),
			};
		}

		throw error;
	}

	const [{ stdout: gitDirOut }, { stdout: commonDirOut }] = await Promise.all([
		runGitReadOnly(['rev-parse', '--absolute-git-dir'], { cwd }),
		runGitReadOnly(['rev-parse', '--git-common-dir'], { cwd }),
	]);
	const gitDir = pathValue(gitDirOut);
	/*
	 * `--git-common-dir` can answer relative to the launch directory (`.git` at
	 * the root, `../../.git` from a nested one), so resolve it against `cwd`:
	 * `fs.watch` needs one absolute root, and it must stay correct for nested
	 * launches and linked worktrees alike.
	 */
	const commonDir = path.resolve(cwd, pathValue(commonDirOut));

	if (isBare) {
		// A bare repo has no worktree; its git dir is the config location.
		return {
			repo: { kind: 'bare', gitDir },
			identity: await readIdentity(gitDir),
		};
	}

	const { stdout: rootOut } = await runGitReadOnly(
		['rev-parse', '--show-toplevel'],
		{
			cwd,
		},
	);
	const root = pathValue(rootOut);

	return {
		repo: { kind: 'repo', root, gitDir, commonDir },
		identity: await readIdentity(root),
	};
};
