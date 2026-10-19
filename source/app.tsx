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
import { theme } from './theme.js';
import { getLayout } from './layout.js';
import Toolbar from './components/toolbar.js';
import CommandMenu from './components/command-menu.js';
import CommitMenu from './components/commit-menu.js';
import Sidebar from './components/sidebar.js';
import ExplorerPanel, {
	type ExplorerTab,
} from './components/explorer-panel.js';
import RightPanel from './components/right-panel.js';
import ErrorOverlay from './components/error-overlay.js';
import ConfirmOverlay from './components/confirm-overlay.js';
import ConsolePanel from './components/console-panel.js';
import { sidebarSections } from './data/sample.js';

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
	const { failedOperation, commit: repoCommit } = repoState;
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

	const handleCommand = useCallback((id: CommandId) => {
		setActiveCommand(id);
		setOverlay(undefined);
	}, []);

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
							width={layout.columns}
							activeCommand={activeCommand}
							operation={repoState.operation}
							entry={latestEntry}
							isWatchDegraded={repoState.watchDegraded}
							hasDetailsHint={
								overlay === undefined &&
								failedOperation !== undefined &&
								!isCommitFocused
							}
							onCommand={handleCommand}
							onOpenMenu={() => {
								openOverlay({ kind: 'remote' });
							}}
						/>
						{repoState.kind === 'repo' ? (
							<Box flexDirection="row" height={layout.bodyHeight}>
								<Sidebar
									sections={sidebarSections}
									width={layout.sidebarWidth}
									height={layout.bodyHeight}
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
						<CommandMenu onSelect={handleCommand} onClose={closeOverlay} />
					) : null}
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
