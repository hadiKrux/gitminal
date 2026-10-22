#!/usr/bin/env node
import process from 'node:process';
import React from 'react';
import { render } from 'ink';
import App from './app.js';
import { createFilteredStdin } from './filtered-stdin.js';
import { killActiveGitChildren } from './git/exec.js';
import { loadKeybindings } from './keybindings.js';

/*
 * A normal quit (including Ink's ctrl+c path) ends with process exit, so this
 * synchronous handler is the last chance to kill git process groups that are
 * still running. SIGINT/SIGTERM handlers are deliberately not installed: Ink
 * owns signal handling, and adding our own listener would stop signal-exit
 * from performing its terminal cleanup.
 */
process.on('exit', killActiveGitChildren);

const app = render(<App keybindings={loadKeybindings()} />, {
	stdin: createFilteredStdin(),
});

/*
 * A live git child keeps the event loop alive, so the process may not reach
 * its `exit` event while a command is still running. Ink resolves this promise
 * when the app unmounts on a normal quit; kill there too so shutdown does not
 * wait for a hung or long git command. The set is cleared, so the `exit`
 * handler is a safe second call.
 */
try {
	await app.waitUntilExit();
} finally {
	killActiveGitChildren();
}
