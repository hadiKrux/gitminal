import { useCallback, useMemo, useState } from 'react';
import type { WorkingFile, WorkingGroupCategory } from '../data/types.js';

/** Untracked files get their own group; everything else is a working change. */
export const categoryOf = (file: WorkingFile): WorkingGroupCategory =>
	file.status === 'untracked' ? 'untracked' : 'working';

export type WorkingTree = {
	readonly files: readonly WorkingFile[];
	readonly stagedCount: number;
	isStaged: (path: string) => boolean;
	hasUnstaged: (category: WorkingGroupCategory) => boolean;
	toggleStage: (path: string) => void;
	stageAll: (category: WorkingGroupCategory) => void;
	unstageAll: (category: WorkingGroupCategory) => void;
	discard: (path: string) => void;
	discardAll: (category: WorkingGroupCategory) => void;
	commit: () => void;
};

const without = (paths: ReadonlySet<string>, removed: ReadonlySet<string>) =>
	new Set([...paths].filter(path => !removed.has(path)));

/** The paths of every file in a group, used by the bulk stage/unstage actions. */
const pathsIn = (
	files: readonly WorkingFile[],
	category: WorkingGroupCategory,
): ReadonlySet<string> =>
	new Set(
		files.filter(file => categoryOf(file) === category).map(file => file.path),
	);

/**
 * A thin view model over the real working files.
 *
 * The files are owned by `useRepo` and passed in on every render: copying them
 * into local state would freeze the panel at first render and make every
 * refresh invisible. Only the temporary stage/discard sets live here, so the
 * buttons have somewhere to point until real actions exist.
 *
 * Temporary until ticket 02: `toggleStage`, `stageAll`, `unstageAll`,
 * `discard`, `discardAll`, and `commit` only mutate those sets and never touch
 * git; the next refresh restores the real state.
 */
export const useWorkingTree = (files: readonly WorkingFile[]): WorkingTree => {
	const [temporaryStaged, setTemporaryStaged] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const [temporaryDiscarded, setTemporaryDiscarded] = useState<
		ReadonlySet<string>
	>(() => new Set());

	const visibleFiles = useMemo(
		() => files.filter(file => !temporaryDiscarded.has(file.path)),
		[files, temporaryDiscarded],
	);

	/** The union of what git really staged and what was temporarily staged. */
	const stagedPaths = useMemo(() => {
		const paths = new Set(temporaryStaged);

		for (const file of files) {
			if (file.staged) {
				paths.add(file.path);
			}
		}

		return paths;
	}, [files, temporaryStaged]);

	const stagedCount = useMemo(
		() => visibleFiles.filter(file => stagedPaths.has(file.path)).length,
		[visibleFiles, stagedPaths],
	);

	const isStaged = useCallback(
		(path: string) => stagedPaths.has(path),
		[stagedPaths],
	);

	/**
	 * A group has unstaged work when any of its files is not (temporarily)
	 * staged, or still carries a worktree change beyond its staged state. This
	 * is what decides between the Stage All / Discard All and Unstage All
	 * buttons on the group header.
	 */
	const hasUnstaged = useCallback(
		(category: WorkingGroupCategory) =>
			visibleFiles.some(
				file =>
					categoryOf(file) === category &&
					(!stagedPaths.has(file.path) || file.hasUnstaged),
			),
		[visibleFiles, stagedPaths],
	);

	const toggleStage = useCallback((path: string) => {
		setTemporaryStaged(current => {
			const next = new Set(current);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}

			return next;
		});
	}, []);

	const stageAll = useCallback(
		(category: WorkingGroupCategory) => {
			setTemporaryStaged(
				current => new Set([...current, ...pathsIn(visibleFiles, category)]),
			);
		},
		[visibleFiles],
	);

	const unstageAll = useCallback(
		(category: WorkingGroupCategory) => {
			setTemporaryStaged(current =>
				without(current, pathsIn(visibleFiles, category)),
			);
		},
		[visibleFiles],
	);

	const hide = useCallback((paths: ReadonlySet<string>) => {
		setTemporaryDiscarded(current => new Set([...current, ...paths]));
		setTemporaryStaged(current => without(current, paths));
	}, []);

	const discard = useCallback(
		(path: string) => {
			hide(new Set([path]));
		},
		[hide],
	);

	const discardAll = useCallback(
		(category: WorkingGroupCategory) => {
			hide(pathsIn(visibleFiles, category));
		},
		[visibleFiles, hide],
	);

	const commit = useCallback(() => {
		hide(new Set(stagedPaths));
	}, [hide, stagedPaths]);

	return {
		files: visibleFiles,
		stagedCount,
		isStaged,
		hasUnstaged,
		toggleStage,
		stageAll,
		unstageAll,
		discard,
		discardAll,
		commit,
	};
};
