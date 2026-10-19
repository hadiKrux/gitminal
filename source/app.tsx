import { EventEmitter } from 'node:events';
import React, { useCallback, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import { MouseProvider, useMouse } from '@zenobius/ink-mouse';
import { useStdoutDimensions } from './hooks/use-stdout-dimensions.js';
import {
	KeyboardProvider,
	useKeyboardShortcuts,
} from './hooks/use-keyboard-shortcuts.js';
import { useRepo, type RepoKind } from './hooks/use-repo.js';
import { useWorkingTree } from './hooks/use-working-tree.js';
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
import { repo } from './data/sample.js';

/**
 * The mouse layer registers one listener per interactive element, and the
 * commit panel alone has dozens of rows and buttons. Raise Node's default cap
 * so it does not warn about every extra row.
 */
EventEmitter.defaultMaxListeners = 256;

type Props = {
	readonly columns?: number;
	readonly rows?: number;
	readonly keybindings?: ResolvedKeybindings;
};

type Overlay = 'remote' | 'commit';

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
}: {
	readonly isActive: boolean;
	readonly onCommand: (id: CommandId) => void;
	readonly onOpenMenu: () => void;
	readonly onFocusCommit: () => void;
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
	const repoState = useRepo();
	const workingTree = useWorkingTree(repoState.workingFiles);

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

	const commit = useCallback(() => {
		workingTree.commit();
		setMessage('');
		setOverlay(undefined);
	}, [workingTree]);

	return (
		<KeyboardProvider keybindings={keybindings}>
			<MouseProvider>
				<GlobalShortcuts
					isActive={overlay === undefined && !isCommitFocused}
					onCommand={handleCommand}
					onOpenMenu={() => {
						openOverlay('remote');
					}}
					onFocusCommit={() => {
						setIsCommitFocused(true);
					}}
				/>
				<Box flexDirection="column" width={layout.columns} height={layout.rows}>
					<Toolbar
						branch={repoState.branch}
						width={layout.columns}
						activeCommand={activeCommand}
						onCommand={handleCommand}
						onOpenMenu={() => {
							openOverlay('remote');
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
								workingTree={workingTree}
								onMessageChange={setMessage}
								onFocusCommit={() => {
									setIsCommitFocused(true);
								}}
								onBlurCommit={() => {
									setIsCommitFocused(false);
								}}
								onOpenCommitMenu={() => {
									openOverlay('commit');
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
					{overlay === 'remote' ? (
						<CommandMenu onSelect={handleCommand} onClose={closeOverlay} />
					) : null}
					{overlay === 'commit' ? (
						<CommitMenu
							onSelect={() => {
								commit();
							}}
							onClose={closeOverlay}
						/>
					) : null}
				</Box>
			</MouseProvider>
		</KeyboardProvider>
	);
}
