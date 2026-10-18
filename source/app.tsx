import React, { useCallback, useState } from 'react';
import { Box, useApp } from 'ink';
import { MouseProvider, useMouse } from '@zenobius/ink-mouse';
import { useStdoutDimensions } from './hooks/use-stdout-dimensions.js';
import {
	KeyboardProvider,
	useKeyboardShortcuts,
} from './hooks/use-keyboard-shortcuts.js';
import { defaultKeybindings, type ResolvedKeybindings } from './keybindings.js';
import { type CommandId } from './commands.js';
import { getLayout } from './layout.js';
import Toolbar from './components/toolbar.js';
import CommandMenu from './components/command-menu.js';
import Sidebar from './components/sidebar.js';
import CommitList from './components/commit-list.js';
import RightPanel from './components/right-panel.js';
import { repo } from './data/sample.js';

type Props = {
	readonly columns?: number;
	readonly rows?: number;
	readonly keybindings?: ResolvedKeybindings;
};

/**
 * App-wide shortcuts. They are disabled while an overlay is open so the
 * overlay owns input; the character keys (q, p, ...) must not leak through.
 */
function GlobalShortcuts({
	isActive,
	onCommand,
	onOpenMenu,
}: {
	readonly isActive: boolean;
	readonly onCommand: (id: CommandId) => void;
	readonly onOpenMenu: () => void;
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
	const [isMenuOpen, setIsMenuOpen] = useState(false);

	const handleCommand = useCallback((id: CommandId) => {
		setActiveCommand(id);
		setIsMenuOpen(false);
	}, []);

	return (
		<KeyboardProvider keybindings={keybindings}>
			<MouseProvider>
				<GlobalShortcuts
					isActive={!isMenuOpen}
					onCommand={handleCommand}
					onOpenMenu={() => {
						setIsMenuOpen(true);
					}}
				/>
				<Box flexDirection="column" width={layout.columns} height={layout.rows}>
					<Toolbar
						branch={repo.branch}
						width={layout.columns}
						activeCommand={activeCommand}
						onCommand={handleCommand}
						onOpenMenu={() => {
							setIsMenuOpen(true);
						}}
					/>
					<Box flexDirection="row" height={layout.bodyHeight}>
						<Sidebar
							sections={repo.sections}
							width={layout.sidebarWidth}
							height={layout.bodyHeight}
						/>
						<CommitList
							commits={repo.commits}
							selectedIndex={repo.selectedCommit}
							width={layout.commitsWidth}
							height={layout.bodyHeight}
						/>
						<RightPanel
							repo={repo}
							width={layout.rightWidth}
							height={layout.bodyHeight}
						/>
					</Box>
					{isMenuOpen ? (
						<CommandMenu
							onSelect={handleCommand}
							onClose={() => {
								setIsMenuOpen(false);
							}}
						/>
					) : null}
				</Box>
			</MouseProvider>
		</KeyboardProvider>
	);
}
