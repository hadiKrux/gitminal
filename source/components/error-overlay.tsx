import React, { useRef, useState } from 'react';
import { Box, type DOMElement } from 'ink';
import { useKeyboardShortcuts } from '../hooks/use-keyboard-shortcuts.js';
import { useMouseTarget } from '../hooks/use-mouse.js';
import { useStdoutDimensions } from '../hooks/use-stdout-dimensions.js';
import { theme } from '../theme.js';
import { truncate } from '../layout.js';
import { splitOutputLines } from '../data/format.js';
import type { OperationLogEntry } from '../hooks/use-repo.js';
import ModalFrame, { FrameRow, Line, contentWidth } from './modal-frame.js';

type Props = {
	readonly operation: OperationLogEntry;
	readonly onClose: () => void;
};

/**
 * Rows given to the captured output, derived from the terminal height so a
 * short terminal still shows the frame: at least a few lines of output, at most
 * about two thirds of a tall one.
 */
const outputHeight = (rows: number | undefined): number =>
	Math.max(3, Math.min(16, Math.round((rows ?? 30) * 0.4)));

/**
 * `undefined` means the process was killed or never started, not exit 0.
 *
 * A synthetic failure (watch degradation, an edge probe) has no argv and no
 * exit code; saying "killed or failed to start" there would be wrong, so it
 * only reports the missing code.
 */
const exitLabel = (operation: OperationLogEntry): string => {
	const { error } = operation;
	if (error?.exitCode !== undefined) {
		return `exit code ${error.exitCode}`;
	}

	if (error !== undefined && error.args.length === 0) {
		return 'no exit code';
	}

	return 'no exit code (killed or failed to start)';
};

/**
 * The scrollable error detail overlay for a failed operation.
 *
 * The status line shows the one-line summary; this is where the whole captured
 * command output lives, because that is what a user needs to act on a git
 * failure. Escape closes it, arrows and page keys scroll it, and the wheel
 * scrolls only while the pointer is over the output. It stays open through
 * clicks (the mouse gate blocks everything under it).
 */
export default function ErrorOverlay({ operation, onClose }: Props) {
	const [, rows] = useStdoutDimensions();

	const { error } = operation;
	const captured = [error?.stdout ?? '', error?.stderr ?? '']
		.filter(text => text.length > 0)
		.join('\n');
	// A timeout or synthetic failure can have no captured output; show the
	// error's own message instead of claiming there is no detail. Split the
	// raw text before sanitizing so a CR-framed progress update and the fatal
	// line after it stay separate rows.
	const output = captured.length > 0 ? captured : error?.message ?? '';
	const lines = splitOutputLines(output);

	const height = outputHeight(rows);
	const content = output.length === 0 ? ['(no output captured)'] : lines;
	const maxOffset = Math.max(0, content.length - height);

	const [scrollOffset, setScrollOffset] = useState(0);
	const bodyRef = useRef<DOMElement>(null);

	const offset = Math.min(scrollOffset, maxOffset);
	const visible = content.slice(offset, offset + height);

	const scrollBy = (delta: number): void => {
		setScrollOffset(current =>
			Math.max(0, Math.min(current + delta, maxOffset)),
		);
	};

	useKeyboardShortcuts({
		'close-overlay': onClose,
		'move-down'() {
			scrollBy(1);
		},
		'move-up'() {
			scrollBy(-1);
		},
		'page-down'() {
			scrollBy(height);
		},
		'page-up'() {
			scrollBy(-height);
		},
	});

	useMouseTarget(bodyRef, {
		onScroll(direction) {
			scrollBy(direction === 'scrolldown' ? 1 : -1);
		},
	});

	return (
		<ModalFrame title="Error">
			<FrameRow>
				<Line
					segments={[
						{ text: operation.label, color: theme.text, isBold: true },
					]}
				/>
			</FrameRow>
			<FrameRow>
				<Line segments={[{ text: exitLabel(operation), color: theme.del }]} />
			</FrameRow>
			<Box ref={bodyRef} flexDirection="column">
				{Array.from({ length: height }, (_, index) => {
					const text = visible[index] ?? '';

					return (
						<FrameRow key={offset + index}>
							<Line
								segments={[
									{
										text:
											text.length === 0 ? ' ' : truncate(text, contentWidth),
										color: output.length === 0 ? theme.dimmer : theme.dim,
									},
								]}
							/>
						</FrameRow>
					);
				})}
			</Box>
			<FrameRow>
				<Line
					segments={[
						{ text: 'esc', color: theme.accent, isBold: true },
						{ text: ' close', color: theme.dim },
					]}
				/>
			</FrameRow>
		</ModalFrame>
	);
}
