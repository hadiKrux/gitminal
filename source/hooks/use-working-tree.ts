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
	discard: (path: string) => void;
	discardAll: (category: WorkingGroupCategory) => void;
	commit: () => void;
};

const without = (paths: ReadonlySet<string>, removed: ReadonlySet<string>) =>
	new Set([...paths].filter(path => !removed.has(path)));

/**
 * Owns the pending working-tree changes.
 *
 * Staging is tracked separately from the files themselves so a staged file
 * keeps its place in the list; discarding and committing remove files, because
 * both operations take the change out of the working tree.
 */
export const useWorkingTree = (
	initialFiles: readonly WorkingFile[],
): WorkingTree => {
	const [files, setFiles] = useState<readonly WorkingFile[]>(initialFiles);
	const [stagedPaths, setStagedPaths] = useState<ReadonlySet<string>>(
		() => new Set(),
	);

	const stagedCount = useMemo(
		() => files.filter(file => stagedPaths.has(file.path)).length,
		[files, stagedPaths],
	);

	const isStaged = useCallback(
		(path: string) => stagedPaths.has(path),
		[stagedPaths],
	);

	const hasUnstaged = useCallback(
		(category: WorkingGroupCategory) =>
			files.some(
				file => categoryOf(file) === category && !stagedPaths.has(file.path),
			),
		[files, stagedPaths],
	);

	const toggleStage = useCallback((path: string) => {
		setStagedPaths(current => {
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
			setStagedPaths(current => {
				const next = new Set(current);
				for (const file of files) {
					if (categoryOf(file) === category) {
						next.add(file.path);
					}
				}

				return next;
			});
		},
		[files],
	);

	const discard = useCallback((path: string) => {
		setFiles(current => current.filter(file => file.path !== path));
		setStagedPaths(current => without(current, new Set([path])));
	}, []);

	const discardAll = useCallback(
		(category: WorkingGroupCategory) => {
			setFiles(current =>
				current.filter(file => categoryOf(file) !== category),
			);
			setStagedPaths(current => {
				const removed = new Set(
					files
						.filter(file => categoryOf(file) === category)
						.map(file => file.path),
				);
				return without(current, removed);
			});
		},
		[files],
	);

	const commit = useCallback(() => {
		const committed = new Set(
			files.filter(file => stagedPaths.has(file.path)).map(file => file.path),
		);
		setFiles(current => current.filter(file => !committed.has(file.path)));
		setStagedPaths(new Set());
	}, [files, stagedPaths]);

	return {
		files,
		stagedCount,
		isStaged,
		hasUnstaged,
		toggleStage,
		stageAll,
		discard,
		discardAll,
		commit,
	};
};
