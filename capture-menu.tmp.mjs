#!/usr/bin/env node
// Renders gitminal's layout with the remote-operations menu open and saves the
// final frame so the current look can be inspected offline.
import { Transform } from 'node:stream';
import React from 'react';
import { writeFileSync } from 'node:fs';
import { Box } from '/Users/hadi/repos/gitminal/node_modules/ink/build/index.js';
import { render } from '/Users/hadi/repos/gitminal/node_modules/ink/build/index.js';
import Toolbar from '/Users/hadi/repos/gitminal/dist/components/toolbar.js';
import Sidebar from '/Users/hadi/repos/gitminal/dist/components/sidebar.js';
import CommitList from '/Users/hadi/repos/gitminal/dist/components/commit-list.js';
import RightPanel from '/Users/hadi/repos/gitminal/dist/components/right-panel.js';
import CommandMenu from '/Users/hadi/repos/gitminal/dist/components/command-menu.js';
import { getLayout } from '/Users/hadi/repos/gitminal/dist/layout.js';
import { repo } from '/Users/hadi/repos/gitminal/dist/data/sample.js';
import { KeyboardProvider } from '/Users/hadi/repos/gitminal/dist/hooks/use-keyboard-shortcuts.js';
import { MouseProvider } from '@zenobius/ink-mouse';


const noop = () => {};

const columns = Number(process.argv[2] ?? 100);
const rows = Number(process.argv[3] ?? 30);
const layout = getLayout(columns, rows);

const app = React.createElement(
	KeyboardProvider,
	{},
	React.createElement(
		MouseProvider,
		{},
		React.createElement(
		Box,
		{ flexDirection: 'column', width: layout.columns, height: layout.rows },
		React.createElement(Toolbar, {
			branch: repo.branch,
			width: layout.columns,
			activeCommand: undefined,
			onCommand: noop,
			onOpenMenu: noop,
		}),
		React.createElement(
			Box,
			{ flexDirection: 'row', height: layout.bodyHeight },
			React.createElement(Sidebar, {
				sections: repo.sections,
				width: layout.sidebarWidth,
				height: layout.bodyHeight,
			}),
			React.createElement(CommitList, {
				commits: repo.commits,
				selectedIndex: repo.selectedCommit,
				width: layout.commitsWidth,
				height: layout.bodyHeight,
			}),
			React.createElement(RightPanel, {
				repo,
				width: layout.rightWidth,
				height: layout.bodyHeight,
			}),
		),
		React.createElement(CommandMenu, { onSelect: noop, onClose: noop }),
		),
	),
);

let last = '';
class FakeStdout extends Transform {
	columns = columns;
	rows = rows;
	_transform(chunk, _enc, cb) {
		last = chunk.toString();
		this.push(chunk);
		cb();
	}
}

class FakeStdin extends Transform {
	isTTY = true;
	columns = columns;
	rows = rows;
	setRawMode() {}
	ref() {}
	unref() {}
	_transform(chunk, _enc, cb) {
		this.push(chunk);
		cb();
	}
}
const stdin = new FakeStdin();

const out = new FakeStdout();
const { unmount } = render(app, { stdout: out, stdin, exitOnCtrlC: false });

setTimeout(() => {
	writeFileSync(
		process.argv[4] ?? '/private/var/folders/rm/25cg52b502s_7wr9gm09_rhr0000gn/T/opencode/menu-frame.txt',
		last,
	);
	unmount();
}, 500);
