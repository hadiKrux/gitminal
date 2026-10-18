#!/usr/bin/env node
// Standalone render of just the CommandMenu for layout inspection.
import { writeFileSync } from 'node:fs';
import { Transform } from 'node:stream';
import React from 'react';
import { render } from 'ink';
import { Box } from 'ink';
import CommandMenu from './dist/components/command-menu.js';
import { KeyboardProvider } from './dist/hooks/use-keyboard-shortcuts.js';
import { MouseProvider } from '@zenobius/ink-mouse';

const noop = () => {};

const app = React.createElement(
	KeyboardProvider,
	{},
	React.createElement(
		MouseProvider,
		{},
		React.createElement(
			Box,
			{ width: 100, height: 30 },
			React.createElement(CommandMenu, { onSelect: noop, onClose: noop }),
		),
	),
);

// vertical centering will be skipped since no siblings; make full-screen flex
let last = '';

class FakeStdout extends Transform {
	columns = 100;
	rows = 30;
	_transform(chunk, _enc, cb) {
		last = chunk.toString();
		this.push(chunk);
		cb();
	}
}

class FakeStdin extends Transform {
	isTTY = true;
	columns = 100;
	rows = 30;
	setRawMode() {}
	ref() {}
	unref() {}
	_transform(chunk, _enc, cb) {
		this.push(chunk);
		cb();
	}
}

const out = new FakeStdout();
const { unmount } = render(app, {
	stdout: out,
	stdin: new FakeStdin(),
	exitOnCtrlC: false,
});

setTimeout(() => {
	writeFileSync(process.argv[2], last);
	unmount();
}, 500);
