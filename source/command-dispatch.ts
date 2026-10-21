import type { CommandId } from './commands.js';
import type { RemoteCommandId } from './git/remote.js';

/**
 * The non-remote things a command can do.
 *
 * These names are deliberately actions rather than component names: the app
 * maps each to a hook action or a local callback, so the table stays data and
 * behavior has exactly one home.
 */
export type AppCommandAction =
	| 'stage-all'
	| 'unstage-all'
	| 'discard-all'
	| 'commit'
	| 'commit-no-verify'
	| 'refresh'
	| 'toggle-console';

/** The modal a command opens to collect more input. */
export type CommandOverlay = 'switch-branch' | 'new-branch';

/**
 * What one command id does when it runs.
 *
 * `remote` runs a git operation through the queue, `overlay` opens a modal
 * that collects more input, and `app` calls a repo or app action directly.
 */
export type CommandEffect =
	| { readonly kind: 'remote'; readonly id: RemoteCommandId }
	| {
			readonly kind: 'overlay';
			readonly overlay: CommandOverlay;
	  }
	| { readonly kind: 'app'; readonly action: AppCommandAction };

/**
 * Compile-time exhaustiveness guard.
 *
 * A union that grows without a matching case stops the build where the guard
 * is called, instead of silently falling through to a neighboring branch.
 */
export const assertNever = (value: never): never => {
	throw new Error(`unhandled command dispatch case: ${String(value)}`);
};

/**
 * One effect per command id.
 *
 * The toolbar, the remote menu, the commit menu, and the palette all dispatch
 * through `handleCommand` and therefore this table. `commands.ts` stays pure
 * metadata; adding behavior to a catalog entry means adding the effect here,
 * and the `Record` type makes a missing entry a compile error.
 */
export const commandEffects: Readonly<Record<CommandId, CommandEffect>> = {
	pull: { kind: 'remote', id: 'pull' },
	fetch: { kind: 'remote', id: 'fetch' },
	'fetch-prune': { kind: 'remote', id: 'fetch-prune' },
	push: { kind: 'remote', id: 'push' },
	'push-force': { kind: 'remote', id: 'push-force' },
	'push-no-verify': { kind: 'remote', id: 'push-no-verify' },
	'switch-branch': { kind: 'overlay', overlay: 'switch-branch' },
	'new-branch': { kind: 'overlay', overlay: 'new-branch' },
	'stage-all': { kind: 'app', action: 'stage-all' },
	'unstage-all': { kind: 'app', action: 'unstage-all' },
	'discard-all': { kind: 'app', action: 'discard-all' },
	commit: { kind: 'app', action: 'commit' },
	'commit-no-verify': { kind: 'app', action: 'commit-no-verify' },
	refresh: { kind: 'app', action: 'refresh' },
	'toggle-console': { kind: 'app', action: 'toggle-console' },
};
