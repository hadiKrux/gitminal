import React from 'react';
import { Box, Text } from 'ink';
import { useKeyboardShortcuts } from '../hooks/use-keyboard-shortcuts.js';
import { useStdoutDimensions } from '../hooks/use-stdout-dimensions.js';
import { theme } from '../theme.js';
import { truncate } from '../layout.js';
import { sanitizeOutput } from '../data/format.js';
import type { OperationLogEntry } from '../hooks/use-repo.js';
import ModalFrame, { FrameRow, Line, contentWidth } from './modal-frame.js';
import ScrollableArea from './scrollable-area.js';

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
 * failure. Escape closes it, and it stays open through clicks (the mouse gate
 * blocks everything under it).
 */
export default function ErrorOverlay({ operation, onClose }: Props) {
	const [, rows] = useStdoutDimensions();

	useKeyboardShortcuts({ 'close-overlay': onClose });

	const { error } = operation;
	const captured = [error?.stdout ?? '', error?.stderr ?? '']
		.filter(text => text.length > 0)
		.join('\n');
	// A timeout or synthetic failure can have no captured output; show the
	// error's own message instead of claiming there is no detail.
	const output = sanitizeOutput(
		captured.length > 0 ? captured : error?.message ?? '',
	);

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
			<FrameRow>
				<ScrollableArea width={contentWidth} height={outputHeight(rows)}>
					{innerWidth => (
						<Box flexDirection="column">
							{output.length === 0 ? (
								<Text color={theme.dimmer}>(no output captured)</Text>
							) : (
								output.split('\n').map((text, index) => (
									<Text
										// eslint-disable-next-line react/no-array-index-key
										key={index}
										color={theme.dim}
										wrap="truncate-end"
									>
										{text.length === 0 ? ' ' : truncate(text, innerWidth)}
									</Text>
								))
							)}
						</Box>
					)}
				</ScrollableArea>
			</FrameRow>
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
