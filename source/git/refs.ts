import type { SidebarSection, TreeNode } from '../data/types.js';
import { runGitReadOnly } from './exec.js';

/**
 * Sidebar refs read from one batch of read-only git commands.
 *
 * The sidebar needs four different kinds of ref data, so they are read
 * together and mapped into the existing `SidebarSection` shape here. Keeping
 * the mapping out of `useRepo` means the hook only owns when to read, and the
 * components keep rendering the same model they always have.
 */

/** Sidebar title the app uses when it needs the local branch list. */
export const branchesSectionTitle = 'BRANCHES';

/**
 * Field separator for `git branch --format`.
 *
 * `git branch` accepts `%xx` hex escapes (not `git log`'s `%xNN` form), so the
 * separator is written as `%1f`. Branch and upstream names cannot contain the
 * control character, which makes the split unambiguous.
 */
const field = '%1f';

const branchFormat = `%(refname)${field}%(refname:lstrip=2)${field}%(upstream:short)${field}%(objectname:short)`;
const remoteFormat = '%(refname:lstrip=2)';

/** Output lines without the trailing empty row and platform CRs. */
const lines = (stdout: string): readonly string[] =>
	stdout
		.split('\n')
		.map(line => (line.endsWith('\r') ? line.slice(0, -1) : line))
		.filter(line => line.length > 0);

type BranchRecord = {
	readonly name: string;
	readonly upstream: string;
};

/**
 * Parse the local-branch format.
 *
 * `git branch` also prints a synthetic `(HEAD detached at <oid>)` entry while
 * HEAD is detached. Its `%(refname)` is not a `refs/heads/` ref, so requiring
 * the full ref filters it out; the plain `%(refname:short)` form would have
 * made both the synthetic entry and a same-named tag indistinguishable.
 *
 * `%(refname:lstrip=2)` rather than `%(refname:short)` keeps labels
 * unambiguous when a tag shares a branch name (short names then become
 * `heads/main`), because the sidebar acts on the label with `git switch`.
 */
const parseBranches = (stdout: string): readonly BranchRecord[] =>
	lines(stdout).flatMap(line => {
		const [refname = '', name = '', upstream = ''] = line.split('\u001F');
		return refname.startsWith('refs/heads/') && name.length > 0
			? [{ name, upstream }]
			: [];
	});

/**
 * Group remote branches under their remote.
 *
 * `git branch -r` prints `origin/main`; the first path segment is the remote
 * and the rest is the branch. A symbolic `origin/HEAD` row is not a branch a
 * user can check out, so it is dropped from the tree.
 */
const remoteGroups = (
	remoteBranches: readonly string[],
	activeUpstream: string | undefined,
): { readonly items: TreeNode[]; readonly count: number } => {
	const groups = new Map<string, TreeNode[]>();

	for (const fullName of remoteBranches) {
		const slash = fullName.indexOf('/');
		if (slash <= 0) {
			continue;
		}

		const remote = fullName.slice(0, slash);
		const branch = fullName.slice(slash + 1);
		if (branch.length === 0 || branch === 'HEAD') {
			continue;
		}

		const entries = groups.get(remote) ?? [];
		entries.push({
			label: branch,
			depth: 1,
			...(fullName === activeUpstream ? { active: true } : {}),
		});
		groups.set(remote, entries);
	}

	const items: TreeNode[] = [];
	for (const [remote, entries] of groups) {
		items.push({ label: remote, depth: 0 }, ...entries);
	}

	return { items, count: groups.size };
};

/**
 * Read every ref the sidebar renders.
 *
 * STASHES, SUBMODULES, and WORKTREES are counts only for now: acting on them
 * is explicitly deferred, and a row list without an action would only add
 * navigation the keyboard cannot reach.
 */
export const readRefs = async (options: {
	readonly cwd: string;
	/** Checked-out branch, or undefined for a detached HEAD. */
	readonly currentBranch: string | undefined;
}): Promise<readonly SidebarSection[]> => {
	const [
		{ stdout: branchOut },
		{ stdout: remoteOut },
		{ stdout: tagOut },
		{ stdout: stashOut },
		{ stdout: submoduleOut },
		{ stdout: worktreeOut },
	] = await Promise.all([
		runGitReadOnly(['branch', `--format=${branchFormat}`], {
			cwd: options.cwd,
		}),
		runGitReadOnly(['branch', '-r', `--format=${remoteFormat}`], {
			cwd: options.cwd,
		}),
		runGitReadOnly(['tag', '--sort=-creatordate'], { cwd: options.cwd }),
		runGitReadOnly(['stash', 'list'], { cwd: options.cwd }),
		runGitReadOnly(['submodule', 'status'], { cwd: options.cwd }),
		runGitReadOnly(['worktree', 'list'], { cwd: options.cwd }),
	]);

	const branches = parseBranches(branchOut);
	const activeUpstream = branches.find(
		branch => branch.name === options.currentBranch,
	)?.upstream;
	const remotes = remoteGroups(lines(remoteOut), activeUpstream);
	const tags = lines(tagOut);

	return [
		{
			title: branchesSectionTitle,
			count: branches.length,
			collapsed: false,
			items: branches.map(branch => ({
				label: branch.name,
				depth: 0,
				...(branch.name === options.currentBranch ? { active: true } : {}),
			})),
		},
		{
			title: 'REMOTES',
			count: remotes.count,
			collapsed: false,
			items: remotes.items,
		},
		{
			title: 'TAGS',
			count: tags.length,
			collapsed: false,
			items: tags.map(tag => ({ label: tag, depth: 0 })),
		},
		{
			title: 'STASHES',
			count: lines(stashOut).length,
			collapsed: false,
			items: [],
		},
		{
			title: 'SUBMODULES',
			count: lines(submoduleOut).length,
			collapsed: false,
			items: [],
		},
		{
			title: 'WORKTREES',
			count: lines(worktreeOut).length,
			collapsed: false,
			items: [],
		},
	];
};
