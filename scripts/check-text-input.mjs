#!/usr/bin/env node
/**
 * Focused regressions for keystroke classification in the commit message box.
 *
 * Run after `npm run build`:
 *   node scripts/check-text-input.mjs
 *
 * The cases mirror the defect: terminals send DEL (`\u007F`) for the Backspace
 * key, Ink reports DEL as `key.delete` (the real Delete key, `\u001B[3~`,
 * arrives through the same flag), and the text area that trusts the flags sees
 * Backspace as a forward delete, which erases nothing at the end of a line.
 * Backspace must delete backward from both byte forms terminals use, and the
 * Delete key must keep deleting forward.
 */
import assert from 'node:assert/strict';
import process from 'node:process';
import { PassThrough } from 'node:stream';
import React, { useState } from 'react';
import { render } from 'ink';
import CommitMessageInput from '../dist/components/commit-message-input.js';
import {
	createFilteredStdin,
	normalizeBackspace,
} from '../dist/filtered-stdin.js';

const check = (name, actual, expected) => {
	assert.equal(
		actual,
		expected,
		`${name}\n  expected: ${JSON.stringify(
			expected,
		)}\n  actual:   ${JSON.stringify(actual)}`,
	);
	process.stdout.write(`ok ${name}\n`);
};

// U1: the byte rewrite is the whole fix at the stream boundary, so it must
// touch DEL and nothing else: the Delete key sequence stays intact and the
// Ctrl+H form passes through unchanged.
check('U1 DEL becomes BS', normalizeBackspace('ab\u007Fc'), 'ab\bc');
check('U1 Delete key survives', normalizeBackspace('\u001B[3~'), '\u001B[3~');
check('U1 BS passes through', normalizeBackspace('\b'), '\b');

/** Give React and the stream pipeline time to settle after each key. */
const settle = (milliseconds = 30) =>
	new Promise(resolve => {
		setTimeout(resolve, milliseconds);
	});

/**
 * Drive the real text area through the same filtered stdin `cli.tsx` hands to
 * Ink, so the assertions cover the byte rewrite, Ink's key parsing, and the
 * component's editing behavior end to end.
 */
const checkEditing = async () => {
	const source = new PassThrough();

	// The wrapper forwards these to its source, so the fake one has to carry
	// them the way `process.stdin` does.
	source.isTTY = true;
	source.setRawMode = () => {};
	source.ref = () => {};
	source.unref = () => {};

	const stdin = createFilteredStdin(source);
	const stdout = new PassThrough();
	stdout.columns = 80;
	stdout.rows = 24;
	stdout.on('data', () => {});

	const report = {
		value: () => '',
	};

	function Harness() {
		const [value, setValue] = useState('');
		report.value = () => value;

		return React.createElement(CommitMessageInput, {
			value,
			width: 20,
			height: 3,
			placeholder: 'message',
			isDisabled: false,
			onChange: setValue,
		});
	}

	const instance = render(React.createElement(Harness), {
		stdin,
		stdout,
		patchConsole: false,
	});
	await settle(100);

	const press = async (name, key, expected) => {
		source.write(key);
		await settle();
		check(name, report.value(), expected);
	};

	// T1: typing still lands as text.
	await press('T1 type first key', 'a', 'a');
	await press('T1 type second key', 'b', 'ab');
	await press('T1 type third key', 'c', 'abc');

	// T2: Backspace as DEL (what terminals send) erases backward. This is the
	// regression: with the byte unrepaired it forwards-deleted and the cursor
	// sits at the end, so the key did nothing at all.
	await press('T2 Backspace deletes backward', '\u007F', 'ab');

	// T3: Backspace as BS (terminals configured for Ctrl+H) keeps working.
	await press('T3 BS deletes backward', '\b', 'a');

	// T4: mid-line Backspace still erases the character before the cursor.
	await press('T4 type around the cursor', 'b', 'ab');
	await press('T4 type around the cursor', 'c', 'abc');
	await press('T4 left arrow', '\u001B[D', 'abc');
	await press('T4 mid-line Backspace', '\u007F', 'ac');

	// T5: the real Delete key keeps deleting forward.
	await press('T5 Delete deletes forward', '\u001B[3~', 'a');

	// T6: Backspace on an empty message is a no-op.
	await press('T6 Backspace empties', '\u007F', '');
	await press('T6 Backspace on empty is a no-op', '\u007F', '');

	instance.unmount();
	await settle();
};

await checkEditing();

process.stdout.write('text input regressions passed\n');
