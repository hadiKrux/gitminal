import { EventEmitter } from 'node:events';
import React, { useCallback, useState } from 'react';
import { Box, useApp } from 'ink';
import { MouseProvider, useMouse } from '@zenobius/ink-mouse';
import { useStdoutDimensions } from './hooks/use-stdout-dimensions.js';
import {
	KeyboardProvider,
	useKeyboardShortcuts,
} from './hooks/use-keyboard-shortcuts.js';
import { useWorkingTree } from './hooks/use-working-tree.js';
import { defaultKeybindings, type ResolvedKeybindings } from './keybindings.js';
import { type CommandId } from './commands.js';
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
	const workingTree = useWorkingTree(repo.workingFiles);

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
						branch={repo.branch}
						width={layout.columns}
						activeCommand={activeCommand}
						onCommand={handleCommand}
						onOpenMenu={() => {
							openOverlay('remote');
						}}
					/>
					<Box flexDirection="row" height={layout.bodyHeight}>
						<Sidebar
							sections={repo.sections}
							width={layout.sidebarWidth}
							height={layout.bodyHeight}
						/>
						<ExplorerPanel
							repo={repo}
							width={layout.commitsWidth}
							height={layout.bodyHeight}
							isActive={overlay === undefined && !isCommitFocused}
						/>
						<RightPanel
							repo={repo}
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
