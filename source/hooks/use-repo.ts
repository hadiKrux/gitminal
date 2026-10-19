import process from 'node:process';
import { useCallback, useEffect, useRef, useState } from 'react';
import { GitNotFoundError } from '../git/exec.js';
import { resolveRepoInfo, type Identity } from '../git/repo-info.js';
import { readStatus } from '../git/status.js';
import { mapStatus } from '../data/map.js';
import type { FileGroup, WorkingFile } from '../data/types.js';

/** Which view the app should render; only `repo` carries working-tree data. */
export type RepoKind =
	| 'loading'
	| 'repo'
	| 'not-a-repo'
	| 'bare'
	| 'git-not-found'
	| 'error';

export type RepoState = {
	readonly kind: RepoKind;
	/** Repository root; porcelain paths are relative to it. */
	readonly root: string | undefined;
	readonly branch: string;
	readonly workingFiles: readonly WorkingFile[];
	readonly fileGroups: readonly FileGroup[];
	readonly identity: Identity | undefined;
	/** Failure detail for the `error` kind; undefined otherwise. */
	readonly detail: string | undefined;
	refresh: () => void;
};

type RepoSnapshot = Omit<RepoState, 'refresh'>;

/** Edge states have no working tree; the app renders their message instead. */
const edge = (kind: RepoKind, detail?: string): RepoSnapshot => ({
	kind,
	root: undefined,
	branch: '',
	workingFiles: [],
	fileGroups: [],
	identity: undefined,
	detail,
});

/**
 * Owns the real repository state for the app.
 *
 * Minimal on purpose: resolve the repository once, load status, refresh on
 * demand. Root resolution matters beyond the data: every command runs with
 * `cwd: root`, because porcelain paths are repository-root relative and the CLI
 * may have been launched from a nested subdirectory. The operation queue and
 * the watcher arrive in later tickets.
 */
export const useRepo = (): RepoState => {
	const [state, setState] = useState<RepoSnapshot>(() => edge('loading'));
	const isMounted = useRef(true);
	const requestId = useRef(0);

	const load = useCallback(async (): Promise<void> => {
		requestId.current += 1;
		const request = requestId.current;
		const isCurrent = (): boolean =>
			isMounted.current && requestId.current === request;

		try {
			const probe = await resolveRepoInfo({ cwd: process.cwd() });

			if (!isCurrent()) {
				return;
			}

			if (probe.repo.kind === 'not-a-repo') {
				setState(edge('not-a-repo'));
				return;
			}

			if (probe.repo.kind === 'bare') {
				setState(edge('bare'));
				return;
			}

			const { root } = probe.repo;
			const status = await readStatus({ cwd: root });

			if (!isCurrent()) {
				return;
			}

			const view = mapStatus(status);
			setState({
				kind: 'repo',
				root,
				branch: view.branch,
				workingFiles: view.workingFiles,
				fileGroups: view.fileGroups,
				identity: probe.identity,
				detail: undefined,
			});
		} catch (error: unknown) {
			if (!isCurrent()) {
				return;
			}

			if (error instanceof GitNotFoundError) {
				setState(edge('git-not-found'));
				return;
			}

			setState(
				edge('error', error instanceof Error ? error.message : String(error)),
			);
		}
	}, []);

	useEffect(() => {
		isMounted.current = true;
		void load();

		return () => {
			// A late resolve must not set state after unmount.
			isMounted.current = false;
		};
	}, [load]);

	const refresh = useCallback(() => {
		void load();
	}, [load]);

	return { ...state, refresh };
};
