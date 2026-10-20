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
import { identityLabel, missingIdentityHint } from './git/repo-info.js';
import { defaultKeybindings, type ResolvedKeybindings } from './keybindings.js';
import { type CommandId } from './commands.js';
import { type CommitOptionId } from './commit-options.js';
import { branchesSectionTitle } from './git/refs.js';
import { isRemoteCommandId } from './git/remote.js';
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
import type { SidebarSection, TreeNode } from './data/types.js';

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
			readonly paths: readonly string[];
			readonly onConfirm: () => void;
	  };

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
 * The overlay a command id opens, or undefined when the command runs a git
 * operation directly. Branch commands only collect input here; the actual
 * action runs after the modal's checkout/create handler.
 */
const commandOverlay = (id: CommandId): Overlay | undefined => {
	switch (id) {
		case 'switch-branch': {
			return { kind: 'branch-menu', ref: undefined };
		}

		case 'new-branch': {
			return { kind: 'new-branch' };
		}

		default: {
			return undefined;
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

/** Local branch names for the switch-branch picker. */
const localBranchNames = (
	sections: readonly SidebarSection[],
): readonly string[] =>
	sections
		.find(section => section.title === branchesSectionTitle)
		?.items.map(item => item.label) ?? [];

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
 */
function GlobalShortcuts({
	isActive,
	isConsoleOpen,
	onCommand,
	onOpenMenu,
	onFocusCommit,
	onOpenDetails,
	onToggleConsole,
	onCloseConsole,
	onRefresh,
}: {
	readonly isActive: boolean;
	readonly isConsoleOpen: boolean;
	readonly onCommand: (id: CommandId) => void;
	readonly onOpenMenu: () => void;
	readonly onFocusCommit: () => void;
	readonly onOpenDetails: () => void;
	readonly onToggleConsole: () => void;
	readonly onCloseConsole: () => void;
	readonly onRefresh: () => void;
}) {
	const { exit } = useApp();
	const mouse = useMouse();

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
	} = repoState;
	const latestEntry = repoState.entries.at(-1);

	// The commit box author line: the real identity, or the setup hint when
	// user.name/user.email are unset. The line must never render blank.
	const author =
		repoState.identity === undefined
			? missingIdentityHint
			: identityLabel(repoState.identity);

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

	const handleCommand = useCallback(
		(id: CommandId) => {
			// Branch commands open their own modal instead of running a git
			// operation directly; the same handlers are used by the sidebar,
			// so mouse and keyboard reach identical flows.
			const next = commandOverlay(id);
			if (next !== undefined) {
				openOverlay(next);
				return;
			}

			setActiveCommand(id);
			setOverlay(undefined);

			/*
			 * Remote commands run for real through the queue. Failures open the
			 * same scrollable error overlay as every other git operation; a
			 * success needs nothing because the drain load refreshes the badge,
			 * and a busy-ignored request already reported itself in the status
			 * line, so neither may steal the screen.
			 */
			if (isRemoteCommandId(id)) {
				void runCommand(id).then(failure => {
					if (failure !== undefined) {
						openOverlay({ kind: 'error', operation: failure });
					}
				});
			}
		},
		[openOverlay, runCommand],
	);

	const openDetails = useCallback(() => {
		if (failedOperation !== undefined) {
			openOverlay({ kind: 'error', operation: failedOperation });
		}
	}, [failedOperation, openOverlay]);

	/**
	 * Start a commit and clear the message only when git confirms it.
	 *
	 * The submitted text is captured before the async run: if the user starts
	 * a new draft while the commit is in flight, the updater leaves that newer
	 * text alone instead of clearing something that was never committed.
	 */
	const commit = useCallback(
		(option: CommitOptionId = 'commit'): void => {
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

	return (
		<KeyboardProvider keybindings={keybindings}>
			<MouseProvider>
				<MouseDispatcher />
				<GlobalShortcuts
					isActive={overlay === undefined && !isCommitFocused}
					isConsoleOpen={isConsoleOpen}
					onCommand={handleCommand}
					onOpenMenu={() => {
						openOverlay({ kind: 'remote' });
					}}
					onFocusCommit={focusCommit}
					onOpenDetails={openDetails}
					onToggleConsole={toggleConsole}
					onCloseConsole={closeConsole}
					onRefresh={repoState.refresh}
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
							<Box height={layout.bodyHeight} paddingX={1}>
								<Text color={theme.dim}>
									{edgeMessage(repoState.kind, repoState.detail)}
								</Text>
							</Box>
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
						<CommitMenu onSelect={commit} onClose={closeOverlay} />
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
							paths={overlay.paths}
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
