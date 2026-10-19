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
import { identityLabel } from './git/repo-info.js';
import { defaultKeybindings, type ResolvedKeybindings } from './keybindings.js';
import { type CommandId } from './commands.js';
import { theme } from './theme.js';
import { getLayout } from './layout.js';
import Toolbar from './components/toolbar.js';
import CommandMenu from './components/command-menu.js';
import CommitMenu from './components/commit-menu.js';
import Sidebar from './components/sidebar.js';
import ExplorerPanel from './components/explorer-panel.js';
import RightPanel from './components/right-panel.js';
import ErrorOverlay from './components/error-overlay.js';
import ConfirmOverlay from './components/confirm-overlay.js';
import { repo } from './data/sample.js';

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
	onCommand,
	onOpenMenu,
	onFocusCommit,
	onOpenDetails,
}: {
	readonly isActive: boolean;
	readonly onCommand: (id: CommandId) => void;
	readonly onOpenMenu: () => void;
	readonly onFocusCommit: () => void;
	readonly onOpenDetails: () => void;
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
	const layout = getLayout(columns, rows);

	const [activeCommand, setActiveCommand] = useState<CommandId | undefined>(
		undefined,
	);
	const [overlay, setOverlay] = useState<Overlay | undefined>(undefined);
	const [isCommitFocused, setIsCommitFocused] = useState(false);
	const [message, setMessage] = useState('');

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
	const { failedOperation } = repoState;
	const latestEntry = repoState.entries.at(-1);

	// The commit box author line: the real identity, or the setup hint when
	// user.name/user.email are unset. Ticket 06 refines this into the commit flow.
	const author =
		repoState.identity === undefined ? '' : identityLabel(repoState.identity);

	const openOverlay = useCallback((next: Overlay) => {
		setIsCommitFocused(false);
		setOverlay(next);
	}, []);

	const closeOverlay = useCallback(() => {
		setOverlay(undefined);
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

	// Real commits land with ticket 06. Closing the overlay is all this can do
	// today, and the message is deliberately kept: clearing it here would fake
	// a successful commit and silently drop what the user typed.
	const commit = useCallback(() => {
		setOverlay(undefined);
	}, []);

	return (
		<KeyboardProvider keybindings={keybindings}>
			<MouseProvider>
				<MouseDispatcher />
				<GlobalShortcuts
					isActive={overlay === undefined && !isCommitFocused}
					onCommand={handleCommand}
					onOpenMenu={() => {
						openOverlay({ kind: 'remote' });
					}}
					onFocusCommit={() => {
						setIsCommitFocused(true);
					}}
					onOpenDetails={openDetails}
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
									sections={repo.sections}
									width={layout.sidebarWidth}
									height={layout.bodyHeight}
								/>
								<ExplorerPanel
									commits={repo.commits}
									selectedCommit={repo.selectedCommit}
									fileGroups={repoState.fileGroups}
									width={layout.commitsWidth}
									height={layout.bodyHeight}
									isActive={overlay === undefined && !isCommitFocused}
								/>
								<RightPanel
									author={author}
									width={layout.rightWidth}
									height={layout.bodyHeight}
									message={message}
									isCommitFocused={isCommitFocused}
									isActive={overlay === undefined}
									workingTree={repoState.workingTree}
									onMessageChange={setMessage}
									onFocusCommit={() => {
										setIsCommitFocused(true);
									}}
									onBlurCommit={() => {
										setIsCommitFocused(false);
									}}
									onOpenCommitMenu={() => {
										openOverlay({ kind: 'commit' });
									}}
									onCommit={commit}
								/>
							</Box>
						) : (
							<Box height={layout.bodyHeight} paddingX={1}>
								<Text color={theme.dim}>
									{edgeMessage(repoState.kind, repoState.detail)}
								</Text>
							</Box>
						)}
					</MouseGateContext.Provider>
					{overlay?.kind === 'remote' ? (
						<CommandMenu onSelect={handleCommand} onClose={closeOverlay} />
					) : null}
					{overlay?.kind === 'commit' ? (
						<CommitMenu
							onSelect={() => {
								commit();
							}}
							onClose={closeOverlay}
						/>
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
