import React, { useRef, useState } from 'react';
import { Box, type DOMElement } from 'ink';
import { useKeyboardShortcuts } from '../hooks/use-keyboard-shortcuts.js';
import { useMouseTarget } from '../hooks/use-mouse.js';
import { useStdoutDimensions } from '../hooks/use-stdout-dimensions.js';
import { theme } from '../theme.js';
import { truncate } from '../layout.js';
import { splitOutputLines } from '../data/format.js';
import type { OperationLogEntry } from '../hooks/use-repo.js';
import ModalFrame, { FrameRow, Line, useContentWidth } from './modal-frame.js';

type Props = {
	readonly operation: OperationLogEntry;
	readonly onClose: () => void;
};

/**
 * Rows given to the captured output, derived from the terminal height so a
 * short terminal still shows the frame: at least a few lines of output, at most
 * about two thirds of a tall one. `reservedRows` is the rest of the dialog,
 * including the summary row when the operation has one, so adding that row
 * cannot push the footer off the screen.
 */
const outputHeight = (
	rows: number | undefined,
	reservedRows: number,
): number => {
	const total = rows ?? 30;
	return Math.max(
		3,
		Math.min(16, Math.round(total * 0.4), Math.max(3, total - reservedRows)),
	);
};

/** Lines kept on each side of a very long capture, matching the stored cap. */
const keptLinesPerSide = 200;

/**
 * Bound the rendered capture even when the error arrived from another path.
 *
 * `exec.ts` caps what a `GitError` stores, but synthetic failures and errors
 * created before that cap still reach this overlay. Keeping both ends and
 * naming the omission preserves the command context and the final fatal line
 * without mounting an unbounded number of rows.
 */
const capOutputLines = (lines: readonly string[]): readonly string[] => {
	if (lines.length <= keptLinesPerSide * 2) {
		return lines;
	}

	const omitted = lines.length - keptLinesPerSide * 2;
	const marker = `... ${omitted} line${omitted === 1 ? '' : 's'} omitted ...`;

	return [
		...lines.slice(0, keptLinesPerSide),
		marker,
		...lines.slice(-keptLinesPerSide),
	];
};

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
 * The status line shows the one-line summary; this is where the captured
 * command output is shown, because that is what a user needs to act on a git
 * failure. Escape closes it, arrows and page keys scroll it, and the wheel
 * scrolls only while the pointer is over the output. It stays open through
 * clicks (the mouse gate blocks everything under it).
 */
export default function ErrorOverlay({ operation, onClose }: Props) {
	const [, rows] = useStdoutDimensions();
	const contentWidth = useContentWidth();

	const { error } = operation;
	/*
	 * The summary is the user-facing reason the status line showed, and a
	 * timeout reports "timed out; operation killed" there even when progress
	 * stderr is non-empty. Render it above the capture so that reason cannot be
	 * buried under transport output; split before truncating so a CR-framed
	 * line is sanitized like the captured rows.
	 */
	const summary =
		splitOutputLines(
			operation.summary !== undefined && operation.summary.length > 0
				? operation.summary
				: error?.message ?? '',
		)
			.map(text => text.trim())
			.find(text => text.length > 0) ?? '';
	const captured = [error?.stdout ?? '', error?.stderr ?? '']
		.filter(text => text.length > 0)
		.join('\n');
	// A timeout or synthetic failure can have no captured output; show the
	// error's own message instead of claiming there is no detail. Split the
	// raw text before sanitizing so a CR-framed progress update and the fatal
	// line after it stay separate rows.
	const output = captured.length > 0 ? captured : error?.message ?? '';
	const lines = capOutputLines(splitOutputLines(output));

	const height = outputHeight(rows, summary.length > 0 ? 8 : 7);
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
						{
							text: truncate(operation.label, contentWidth),
							color: theme.text,
							isBold: true,
						},
					]}
				/>
			</FrameRow>
			<FrameRow>
				<Line
					segments={[
						{
							text: truncate(exitLabel(operation), contentWidth),
							color: theme.del,
						},
					]}
				/>
			</FrameRow>
			{summary.length > 0 ? (
				<FrameRow>
					<Line
						segments={[
							{ text: truncate(summary, contentWidth), color: theme.warn },
						]}
					/>
				</FrameRow>
			) : null}
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
