import React, { useCallback, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import { MouseProvider, useMouse } from '@zenobius/ink-mouse';
import { useStdoutDimensions } from './hooks/use-stdout-dimensions.js';
import {
	KeyboardProvider,
	useKeyboardShortcuts,
} from './hooks/use-keyboard-shortcuts.js';
import { MouseDispatcher, MouseGateContext } from './hooks/use-mouse.js';
import {
	useRepo,
	type ConfirmRequest,
	type OperationLogEntry,
	type RepoKind,
} from './hooks/use-repo.js';
import {
	identityLabel,
	missingIdentityHint,
	type Identity,
} from './git/repo-info.js';
import { defaultKeybindings, type ResolvedKeybindings } from './keybindings.js';
import { type CommandId, type CommandAvailability } from './commands.js';
import {
	assertNever,
	commandEffects,
	type AppCommandAction,
	type CommandOverlay,
} from './command-dispatch.js';
import { branchesSectionTitle } from './git/refs.js';
import { theme } from './theme.js';
import { getLayout } from './layout.js';
import Toolbar from './components/toolbar.js';
import RemoteMenu from './components/remote-menu.js';
import CommitMenu from './components/commit-menu.js';
import BranchMenu from './components/branch-menu.js';
import BranchNameInput from './components/branch-name-input.js';
import Sidebar from './components/sidebar.js';
import ExplorerPanel, {
	type ExplorerTab,
} from './components/explorer-panel.js';
import RightPanel from './components/right-panel.js';
import ErrorOverlay from './components/error-overlay.js';
import ConfirmOverlay from './components/confirm-overlay.js';
import ConsolePanel from './components/console-panel.js';
import CommandPalette from './components/command-palette.js';
import type { SidebarSection, TreeNode, WorkingFile } from './data/types.js';

type Props = {
	readonly columns?: number;
	readonly rows?: number;
	readonly keybindings?: ResolvedKeybindings;
};

/**
 * The one exclusive overlay at a time, carrying its own payload. Overlays are
 * modal: escape and the overlay's own actions close them, and while one is open
 * the UI beneath is both key-inactive and mouse-blocked.
 */
type Overlay =
	| { readonly kind: 'remote' }
	| { readonly kind: 'commit' }
	| { readonly kind: 'palette' }
	| {
			readonly kind: 'branch-menu';
			/** The clicked branch, or undefined for the switch-branch picker. */
			readonly ref: string | undefined;
	  }
	| { readonly kind: 'new-branch' }
	| { readonly kind: 'error'; readonly operation: OperationLogEntry }
	| {
			readonly kind: 'confirm';
			readonly label: string;
			readonly description: string;
			readonly confirmLabel: string;
			readonly paths: readonly string[];
			readonly onConfirm: () => void;
	  };

/**
 * The commit variants the app can start.
 *
 * The menu's membership comes from the catalog, while this union only names
 * the two ids whose behavior the app implements directly.
 */
type CommitVariant = 'commit' | 'commit-no-verify';

/** Recently run commands kept for the palette's empty-query order. */
const recentCommandCap = 5;

/**
 * The missing-git screen.
 *
 * Running gitminal without the git binary cannot work at all, so this replaces
 * the generic edge message with the two steps that fix it. It stays inside the
 * normal body layout, which keeps the global quit key available.
 */
function GitNotFoundScreen({ height }: { readonly height: number }) {
	return (
		<Box height={height} paddingX={1} flexDirection="column">
			<Text bold color={theme.text}>
				git not found
			</Text>
			<Text color={theme.dim}>
				gitminal needs the git CLI to read and change the repository.
			</Text>
			<Text color={theme.dim}>
				Install git and make sure it is on PATH, then restart gitminal.
			</Text>
		</Box>
	);
}

/**
 * The body for a state with no working tree.
 *
 * The missing-git screen is distinct because installing git is the only fix;
 * every other edge state keeps the existing one-line message.
 */
function EdgeBody({
	kind,
	detail,
	height,
}: {
	readonly kind: RepoKind;
	readonly detail: string | undefined;
	readonly height: number;
}) {
	if (kind === 'git-not-found') {
		return <GitNotFoundScreen height={height} />;
	}

	return (
		<Box height={height} paddingX={1}>
			<Text color={theme.dim}>{edgeMessage(kind, detail)}</Text>
		</Box>
	);
}

/** Body text for every repository state except a normal worktree. */
const edgeMessage = (kind: RepoKind, detail: string | undefined): string => {
	switch (kind) {
		case 'not-a-repo': {
			return 'not a git repository';
		}

		case 'bare': {
			return 'bare repository is not supported yet';
		}

		case 'git-not-found': {
			return 'git not found';
		}

		case 'error': {
			return detail ?? 'git failed';
		}

		default: {
			return 'loading repository...';
		}
	}
};

/**
 * Local branch rows are the only refs with an action today. Tags and remote
 * branches stay visible but deferred, so both the click handler and the
 * sidebar's affordance use this one predicate.
 */
const isLocalBranchRow = (section: SidebarSection, item: TreeNode): boolean =>
	section.title === branchesSectionTitle && item.depth === 0;

/** The per-ref menu for a clicked local branch; other refs have no action. */
const branchMenuFor = (
	section: SidebarSection,
	item: TreeNode,
): Overlay | undefined =>
	isLocalBranchRow(section, item)
		? { kind: 'branch-menu', ref: item.label }
		: undefined;

/**
 * Turn a dispatch-table overlay kind into the app's modal payload.
 *
 * The switch covers every `CommandOverlay` member and ends in `assertNever`,
 * so adding an overlay to the dispatch table without teaching the app which
 * modal it opens fails the build instead of falling through to another one.
 */
const overlayOf = (kind: CommandOverlay): Overlay => {
	switch (kind) {
		case 'switch-branch': {
			return { kind: 'branch-menu', ref: undefined };
		}

		case 'new-branch': {
			return { kind: 'new-branch' };
		}

		default: {
			return assertNever(kind);
		}
	}
};

/** Local branch names for the switch-branch picker. */
const localBranchNames = (
	sections: readonly SidebarSection[],
): readonly string[] =>
	sections
		.find(section => section.title === branchesSectionTitle)
		?.items.map(item => item.label) ?? [];

/**
 * How many local branches the switch-branch picker can actually move to.
 *
 * The branches section keeps the checked-out branch visible and marks it
 * `active`; switching to it would be a no-op, so it does not make the command
 * available on its own.
 */
const countAlternateBranches = (sections: readonly SidebarSection[]): number =>
	sections
		.find(section => section.title === branchesSectionTitle)
		?.items.filter(item => item.active !== true).length ?? 0;

/** The commit box author line, which must never render blank. */
const authorLabelOf = (identity: Identity | undefined): string =>
	identity === undefined ? missingIdentityHint : identityLabel(identity);

/**
 * Read the palette's gating snapshot from the loaded working tree.
 *
 * Kept as one pure helper rather than a render-local object so the component
 * stays a composition of panels, and so the same staged/unstaged/merge-origin
 * predicates the panels use drive the palette's dimmed reasons.
 */
const commandAvailabilityOf = ({
	kind,
	workingFiles,
	isMergeOrigin,
	hasMessage,
	alternateBranchCount,
}: {
	readonly kind: RepoKind;
	readonly workingFiles: readonly WorkingFile[];
	readonly isMergeOrigin: (path: string) => boolean;
	readonly hasMessage: boolean;
	readonly alternateBranchCount: number;
}): CommandAvailability => ({
	isRepo: kind === 'repo',
	hasStaged: workingFiles.some(file => file.staged),
	hasUnstaged: workingFiles.some(file => !file.staged || file.hasUnstaged),
	hasUnstageable: workingFiles.some(
		file => file.staged && !isMergeOrigin(file.path),
	),
	hasDiscardable: workingFiles.some(
		file => file.status !== 'conflicted' && file.hasUnstaged,
	),
	hasConflicts: workingFiles.some(file => file.status === 'conflicted'),
	hasMessage,
	hasBranches: alternateBranchCount > 0,
});

type BranchOverlaysProps = {
	readonly overlay: Overlay | undefined;
	readonly branches: readonly string[];
	readonly onCheckout: (name: string) => void;
	readonly onCreate: (name: string) => void;
	readonly onNewBranch: () => void;
	readonly onCancel: () => void;
};

/**
 * The two branch modals.
 *
 * Kept as one component so the app's render stays a list of overlay slots and
 * the payload narrowing lives beside the components it feeds.
 */
function BranchOverlays({
	overlay,
	branches,
	onCheckout,
	onCreate,
	onNewBranch,
	onCancel,
}: BranchOverlaysProps) {
	if (overlay?.kind === 'branch-menu') {
		return (
			<BranchMenu
				refName={overlay.ref}
				branches={branches}
				onCheckout={onCheckout}
				onNewBranch={onNewBranch}
				onClose={onCancel}
			/>
		);
	}

	if (overlay?.kind === 'new-branch') {
		return <BranchNameInput onSubmit={onCreate} onCancel={onCancel} />;
	}

	return null;
}

/**
 * App-wide shortcuts. They are disabled while an overlay is open or the commit
 * message owns the keyboard, so neither a modal nor typing leaks a command.
 * The command palette is the one exception: ctrl+p stays live while typing so
 * it can open the palette and blur the box.
 */
function GlobalShortcuts({
	isActive,
	isPaletteActive,
	isConsoleOpen,
	onCommand,
	onOpenMenu,
	onOpenPalette,
	onFocusCommit,
	onOpenDetails,
	onToggleConsole,
	onCloseConsole,
	onRefresh,
}: {
	readonly isActive: boolean;
	/**
	 * The palette shortcut is separate from `isActive`: ctrl+p must open the
	 * palette even while the commit box owns the keyboard, because that is
	 * exactly when opening it has to blur the box.
	 */
	readonly isPaletteActive: boolean;
	readonly isConsoleOpen: boolean;
	readonly onCommand: (id: CommandId) => void;
	readonly onOpenMenu: () => void;
	readonly onOpenPalette: () => void;
	readonly onFocusCommit: () => void;
	readonly onOpenDetails: () => void;
	readonly onToggleConsole: () => void;
	readonly onCloseConsole: () => void;
	readonly onRefresh: () => void;
}) {
	const { exit } = useApp();
	const mouse = useMouse();

	useKeyboardShortcuts(
		{ 'open-command-palette': onOpenPalette },
		{ isActive: isPaletteActive },
	);

	useKeyboardShortcuts(
		{
			quit: exit,
			pull() {
				onCommand('pull');
			},
			push() {
				onCommand('push');
			},
			'toggle-mouse': mouse.toggle,
			'open-remote-menu': onOpenMenu,
			'focus-commit': onFocusCommit,
			refresh: onRefresh,
			'toggle-console': onToggleConsole,
			// Escape closes the non-modal console when it is the only thing
			// open; overlays handle their own close action while displayed.
			'close-overlay'() {
				if (isConsoleOpen) {
					onCloseConsole();
				}
			},
			// Enter opens the failed run's error overlay. It only fires while no
			// overlay is open and the commit box is blurred, so it can never
			// steal the newline the commit message input needs.
			'activate-selection': onOpenDetails,
		},
		{ isActive },
	);

	return null;
}

export default function App({
	columns: columnsProp,
	rows: rowsProp,
	keybindings = defaultKeybindings,
}: Props) {
	const [measuredColumns, measuredRows] = useStdoutDimensions();
	const columns = columnsProp ?? measuredColumns ?? 100;
	const rows = rowsProp ?? measuredRows ?? 30;

	const [activeCommand, setActiveCommand] = useState<CommandId | undefined>(
		undefined,
	);
	const [overlay, setOverlay] = useState<Overlay | undefined>(undefined);
	// Deliberately outside the exclusive `Overlay` union: the console is
	// non-modal, so it coexists with the rest of the UI and with no dialog.
	const [isConsoleOpen, setIsConsoleOpen] = useState(false);
	const [isCommitFocused, setIsCommitFocused] = useState(false);
	const [message, setMessage] = useState('');
	// Session-only recency for the palette: the newest command the user ran
	// floats to the top of the empty-query list, and ties on a query prefer it.
	const [recentCommandIds, setRecentCommandIds] = useState<
		readonly CommandId[]
	>([]);
	// The active explorer tab lives here because it also decides which panel
	// owns the arrow keys: COMMITS moves the commit selection, FILES scrolls
	// the working tree below the commit box.
	const [activeTab, setActiveTab] = useState<ExplorerTab>('commits');

	const layout = getLayout(columns, rows, { isConsoleOpen });
	// On a terminal too short for a usable console the layout gives it zero
	// rows; do not mount a panel that would then overflow the screen.
	const isConsoleVisible = isConsoleOpen && layout.consoleHeight > 0;
	const isConsoleActive = isConsoleVisible && overlay === undefined;

	const requestConfirm = useCallback((request: ConfirmRequest) => {
		// Confirming means leaving the message box: enter must reach the overlay
		// rows, not type a newline.
		setIsCommitFocused(false);
		setOverlay({
			kind: 'confirm',
			label: request.label,
			description: request.description,
			confirmLabel: request.confirmLabel,
			paths: request.paths,
			onConfirm: request.onConfirm,
		});
	}, []);

	const repoState = useRepo({ requestConfirm });
	const {
		failedOperation,
		commit: repoCommit,
		checkout,
		createBranch,
		runCommand,
		stageAllChanges,
		unstageAllChanges,
		discardAllChanges,
		refresh,
	} = repoState;
	const latestEntry = repoState.entries.at(-1);

	// The commit box author line: the real identity, or the setup hint when
	// user.name/user.email are unset. The line must never render blank.
	const author = authorLabelOf(repoState.identity);

	const openOverlay = useCallback((next: Overlay) => {
		setIsCommitFocused(false);
		setOverlay(next);
	}, []);

	const closeOverlay = useCallback(() => {
		setOverlay(undefined);
	}, []);

	/**
	 * Focusing the commit box closes the console: two owners of the arrow keys
	 * is exactly the input-routing bug the console has to avoid.
	 */
	const focusCommit = useCallback(() => {
		setIsConsoleOpen(false);
		setIsCommitFocused(true);
	}, []);

	const toggleConsole = useCallback(() => {
		// Opening the console blurs the message input, so typing cannot leak
		// into the log's key handlers.
		setIsCommitFocused(false);
		setIsConsoleOpen(current => !current);
	}, []);

	const closeConsole = useCallback(() => {
		setIsConsoleOpen(false);
	}, []);

	/** Record one dispatched command, newest first, without duplicates. */
	const rememberCommand = useCallback((id: CommandId) => {
		setRecentCommandIds(current =>
			[id, ...current.filter(item => item !== id)].slice(0, recentCommandCap),
		);
	}, []);

	/**
	 * Start a commit and clear the message only when git confirms it.
	 *
	 * The submitted text is captured before the async run: if the user starts
	 * a new draft while the commit is in flight, the updater leaves that newer
	 * text alone instead of clearing something that was never committed.
	 */
	const commit = useCallback(
		(option: CommitVariant = 'commit'): void => {
			setOverlay(undefined);
			const submitted = message;
			void repoCommit(submitted, {
				noVerify: option === 'commit-no-verify',
			}).then(succeeded => {
				if (succeeded) {
					setMessage(current => (current === submitted ? '' : current));
				}
			});
		},
		[message, repoCommit],
	);

	/**
	 * Run one catalog command through the dispatch table.
	 *
	 * The table is the only place that decides what an id means, so the
	 * toolbar, both menus, and the palette all reach the same flows. Remote
	 * commands close the dialog first and then run through the queue; overlay
	 * commands replace it immediately; app commands close it and call the
	 * matching repo or app action.
	 */
	const handleCommand = useCallback(
		(id: CommandId) => {
			rememberCommand(id);
			const effect = commandEffects[id];

			if (effect.kind === 'remote') {
				closeOverlay();
				setActiveCommand(id);
				/*
				 * Failures open the same scrollable error overlay as every
				 * other git operation; a success needs nothing because the
				 * drain load refreshes the badge, and a busy-ignored request
				 * already reported itself in the status line, so neither may
				 * steal the screen.
				 */
				void runCommand(effect.id).then(failure => {
					if (failure !== undefined) {
						openOverlay({ kind: 'error', operation: failure });
					}
				});
				return;
			}

			if (effect.kind === 'overlay') {
				openOverlay(overlayOf(effect.overlay));
				return;
			}

			/*
			 * App actions act on the repository, not on a dialog: close the
			 * palette or menu before running so no stale overlay survives.
			 * The Record requires an entry for every action, so a new action
			 * cannot fall through and silently do nothing.
			 */
			const appActions: Record<AppCommandAction, () => void> = {
				'stage-all': stageAllChanges,
				'unstage-all': unstageAllChanges,
				'discard-all': discardAllChanges,
				commit() {
					commit('commit');
				},
				'commit-no-verify'() {
					commit('commit-no-verify');
				},
				refresh,
				'toggle-console': toggleConsole,
			};
			closeOverlay();
			appActions[effect.action]();
		},
		[
			closeOverlay,
			openOverlay,
			runCommand,
			stageAllChanges,
			unstageAllChanges,
			discardAllChanges,
			commit,
			refresh,
			toggleConsole,
			rememberCommand,
		],
	);

	const openDetails = useCallback(() => {
		if (failedOperation !== undefined) {
			openOverlay({ kind: 'error', operation: failedOperation });
		}
	}, [failedOperation, openOverlay]);

	/**
	 * Open the error overlay when a branch action reports a failure.
	 *
	 * The action already wrote the entry to the operation log; the overlay is
	 * the same one enter and failed console rows open, so git's dirty-tree
	 * message and a rejected branch name are shown in full. A successful
	 * checkout needs nothing: the drain load refreshes the badge and sidebar.
	 */
	const showBranchFailure = useCallback(
		(failure: OperationLogEntry | undefined): void => {
			if (failure !== undefined) {
				openOverlay({ kind: 'error', operation: failure });
			}
		},
		[openOverlay],
	);

	const handleCheckout = useCallback(
		(name: string): void => {
			closeOverlay();
			void checkout(name).then(showBranchFailure);
		},
		[checkout, closeOverlay, showBranchFailure],
	);

	const handleCreateBranch = useCallback(
		(name: string): void => {
			closeOverlay();
			void createBranch(name).then(showBranchFailure);
		},
		[createBranch, closeOverlay, showBranchFailure],
	);

	const handleSelectRef = useCallback(
		(section: SidebarSection, item: TreeNode): void => {
			// Only local branches have an action today; tags and remote branches
			// are visible refs whose checkout flows are explicitly deferred.
			const next = branchMenuFor(section, item);
			if (next !== undefined) {
				openOverlay(next);
			}
		},
		[openOverlay],
	);

	const branchNames = localBranchNames(repoState.sections);

	/*
	 * One availability snapshot for the palette, derived from the same state
	 * the panels render so a dimmed row and the action it gates cannot
	 * disagree about what is staged, staged-and-unstaged, or merge-origin.
	 */
	const commandAvailability = commandAvailabilityOf({
		kind: repoState.kind,
		workingFiles: repoState.workingFiles,
		isMergeOrigin: repoState.workingTree.isMergeOrigin,
		hasMessage: message.trim().length > 0,
		alternateBranchCount: countAlternateBranches(repoState.sections),
	});

	return (
		<KeyboardProvider keybindings={keybindings}>
			<MouseProvider>
				<MouseDispatcher />
				<GlobalShortcuts
					isActive={overlay === undefined && !isCommitFocused}
					isPaletteActive={overlay === undefined}
					isConsoleOpen={isConsoleOpen}
					onCommand={handleCommand}
					onOpenMenu={() => {
						openOverlay({ kind: 'remote' });
					}}
					onOpenPalette={() => {
						openOverlay({ kind: 'palette' });
					}}
					onFocusCommit={focusCommit}
					onOpenDetails={openDetails}
					onToggleConsole={toggleConsole}
					onCloseConsole={closeConsole}
					onRefresh={refresh}
				/>
				<Box flexDirection="column" width={layout.columns} height={layout.rows}>
					{/*
					 * The gate wraps exactly the UI the overlays cover: while an
					 * overlay is open, clicks land on it and can never fall
					 * through onto the stage/discard buttons beneath it. The
					 * overlays below render outside this provider, so their own
					 * targets stay eligible.
					 */}
					<MouseGateContext.Provider value={overlay !== undefined}>
						<Toolbar
							branch={repoState.branch}
							sync={repoState.sync}
							width={layout.columns}
							activeCommand={activeCommand}
							operation={repoState.operation}
							entry={latestEntry}
							isWatchDegraded={repoState.watchDegraded}
							isMergeInProgress={repoState.mergeInProgress}
							hasDetailsHint={
								overlay === undefined &&
								failedOperation !== undefined &&
								!isCommitFocused
							}
							busyHint={repoState.busyHint}
							onCommand={handleCommand}
							onOpenMenu={() => {
								openOverlay({ kind: 'remote' });
							}}
						/>
						{repoState.kind === 'repo' ? (
							<Box flexDirection="row" height={layout.bodyHeight}>
								<Sidebar
									sections={repoState.sections}
									width={layout.sidebarWidth}
									height={layout.bodyHeight}
									isRefActionable={isLocalBranchRow}
									onSelectRef={handleSelectRef}
								/>
								<ExplorerPanel
									commits={repoState.commits}
									selectedCommit={repoState.selectedCommit}
									hasMoreCommits={repoState.hasMoreCommits}
									isLoadingMoreCommits={repoState.isLoadingMoreCommits}
									fileGroups={repoState.fileGroups}
									width={layout.commitsWidth}
									height={layout.bodyHeight}
									activeTab={activeTab}
									isActive={
										overlay === undefined &&
										!isCommitFocused &&
										!isConsoleVisible
									}
									onTabChange={setActiveTab}
									onSelectCommit={repoState.selectCommit}
									onLoadMoreCommits={repoState.loadMoreCommits}
								/>
								<RightPanel
									author={author}
									width={layout.rightWidth}
									height={layout.bodyHeight}
									message={message}
									isCommitFocused={isCommitFocused}
									isActive={overlay === undefined && !isConsoleVisible}
									isWorkingTreeActive={activeTab === 'files'}
									workingTree={repoState.workingTree}
									onMessageChange={setMessage}
									onFocusCommit={focusCommit}
									onBlurCommit={() => {
										setIsCommitFocused(false);
									}}
									onOpenCommitMenu={() => {
										openOverlay({ kind: 'commit' });
									}}
									onCommit={() => {
										commit('commit');
									}}
								/>
							</Box>
						) : (
							<EdgeBody
								kind={repoState.kind}
								detail={repoState.detail}
								height={layout.bodyHeight}
							/>
						)}
						{isConsoleVisible ? (
							<ConsolePanel
								entries={repoState.entries}
								width={layout.columns}
								height={layout.consoleHeight}
								isActive={isConsoleActive}
								onOpenError={operation => {
									openOverlay({ kind: 'error', operation });
								}}
							/>
						) : null}
					</MouseGateContext.Provider>
					{overlay?.kind === 'remote' ? (
						<RemoteMenu onSelect={handleCommand} onClose={closeOverlay} />
					) : null}
					{overlay?.kind === 'palette' ? (
						<CommandPalette
							rows={rows}
							recentCommandIds={recentCommandIds}
							availability={commandAvailability}
							onRun={handleCommand}
							onClose={closeOverlay}
						/>
					) : null}
					<BranchOverlays
						overlay={overlay}
						branches={branchNames}
						onCheckout={handleCheckout}
						onCreate={handleCreateBranch}
						onNewBranch={() => {
							openOverlay({ kind: 'new-branch' });
						}}
						onCancel={closeOverlay}
					/>
					{overlay?.kind === 'commit' ? (
						<CommitMenu onSelect={handleCommand} onClose={closeOverlay} />
					) : null}
					{overlay?.kind === 'error' ? (
						<ErrorOverlay
							operation={overlay.operation}
							onClose={closeOverlay}
						/>
					) : null}
					{overlay?.kind === 'confirm' ? (
						<ConfirmOverlay
							label={overlay.label}
							description={overlay.description}
							confirmLabel={overlay.confirmLabel}
							paths={overlay.paths}
							rows={rows}
							onConfirm={() => {
								// Close first, then run: the confirmation is done
								// and the overlay must not survive the action.
								const { onConfirm } = overlay;
								closeOverlay();
								onConfirm();
							}}
							onCancel={closeOverlay}
						/>
					) : null}
				</Box>
			</MouseProvider>
		</KeyboardProvider>
	);
}
