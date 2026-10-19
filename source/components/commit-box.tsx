import React, { useRef } from 'react';
import { Box, Text, type DOMElement } from 'ink';
import { useMouseClick } from '../hooks/use-mouse.js';
import { theme } from '../theme.js';
import { textWidth, truncate } from '../layout.js';
import { useKeyboardShortcuts } from '../hooks/use-keyboard-shortcuts.js';
import { commitLabel } from '../labels.js';
import CommitMessageInput, { countVisualRows } from './commit-message-input.js';
import ToolbarButton from './toolbar-button.js';

type Props = {
	readonly author: string;
	readonly width: number;
	readonly message: string;
	/** Visible rows of the message input, computed by `commitMessageRows`. */
	readonly messageRows: number;
	readonly stagedCount: number;
	readonly isFocused: boolean;
	/** False while an overlay owns input. */
	readonly isActive: boolean;
	readonly onMessageChange: (value: string) => void;
	readonly onFocus: () => void;
	readonly onBlur: () => void;
	readonly onOpenMenu: () => void;
	readonly onCommit: () => void;
};

/** Floor of the message area; a single line still gets breathing room. */
// eslint-disable-next-line @typescript-eslint/naming-convention -- exported constant named for the commit box contract
export const MIN_MESSAGE_ROWS = 3;
/** Hard ceiling before the message area scrolls. */
const maxMessageRows = 8;
/**
 * Left inset of the box contents. Working-tree rows start with a two-cell
 * disclosure glyph before their text, so the same inset lines the commit
 * message and the author up with them.
 */
const inset = 2;
/** The overflow button, shown as ` label ` in the toolbar. */
const menuLabel = '...';
const menuWidth = menuLabel.length + 2;

/** Visible width of the message input for a given box width. */
const messageWidthOf = (width: number): number =>
	Math.max(1, width - inset - menuWidth);

/**
 * Rows the message input should take for the current draft.
 *
 * The cap is half the body so the file list keeps usable space on a short
 * terminal, but it never falls below the three-row floor: a tiny terminal
 * still shows a real message area, and the file list keeps its own one-row
 * clamp in `RightPanel`.
 */
export const commitMessageRows = (
	message: string,
	width: number,
	bodyHeight: number,
): number => {
	const cap = Math.max(
		MIN_MESSAGE_ROWS,
		Math.min(maxMessageRows, Math.floor(bodyHeight / 2)),
	);
	const rows = countVisualRows(message, messageWidthOf(width));

	return Math.max(MIN_MESSAGE_ROWS, Math.min(cap, rows));
};

/** Total rows the commit box takes above the working tree. */
export const commitBoxHeight = (messageRows: number): number => messageRows + 1;

/**
 * Cells kept for the author text before the hint may use space.
 *
 * At 80 columns the `Commit N files` button leaves 18 cells in the observed
 * two-file case; seven author cells plus the one-cell gap still leave room for
 * the full `no message` hint, so a long identity cannot erase either side.
 */
const minAuthorWidth = 7;

/**
 * Why the commit action is unavailable, or undefined when it is ready.
 *
 * The hint is deliberately short because it shares one row with the author;
 * the full wording (`commit message is empty`, `nothing staged to commit`)
 * lives in the status line.
 */
const commitHint = (
	message: string,
	stagedCount: number,
): string | undefined => {
	if (stagedCount === 0) {
		return 'stage';
	}

	if (message.trim().length === 0) {
		return 'no message';
	}

	return undefined;
};

/**
 * The top of the commit panel: the commit message input, the author, and the
 * single commit action. Focus is explicit so the global letter shortcuts keep
 * working until the user clicks the input or presses the focus key.
 */
export default function CommitBox({
	author,
	width,
	message,
	messageRows,
	stagedCount,
	isFocused,
	isActive,
	onMessageChange,
	onFocus,
	onBlur,
	onOpenMenu,
	onCommit,
}: Props) {
	const inputRef = useRef<DOMElement>(null);
	const contentWidth = Math.max(1, width - inset);
	const messageWidth = messageWidthOf(width);
	const isCommitReady = stagedCount > 0 && message.trim().length > 0;

	useMouseClick(inputRef, onFocus);

	useKeyboardShortcuts(
		{
			'close-overlay': onBlur,
			commit() {
				// Validation lives in `useRepo.commit`, so the shortcut and the
				// menu report a missing index or message the same way in the
				// status line.
				onCommit();
			},
		},
		{ isActive: isActive && isFocused },
	);

	const label = commitLabel(stagedCount);
	const authorWidth = Math.max(0, contentWidth - (label.length + 2));
	const hint = commitHint(message, stagedCount);
	const hintGap = hint !== undefined && author.length > 0 ? 1 : 0;
	// Reserve the author prefix before the hint takes its cells: the hint must
	// stay readable without erasing the identity line.
	const hintBudget = Math.max(0, authorWidth - minAuthorWidth - hintGap);
	const hintText = hint === undefined ? '' : truncate(hint, hintBudget);
	const hintWidth = textWidth(hintText);
	const authorText = truncate(
		author,
		Math.max(0, authorWidth - hintWidth - hintGap),
	);
	const authorUsed = textWidth(authorText) + hintWidth + hintGap;
	const authorFill = ' '.repeat(Math.max(0, authorWidth - authorUsed));

	return (
		<Box flexDirection="column" width={width} paddingLeft={inset}>
			<Box flexDirection="row" width={contentWidth} alignItems="flex-start">
				<Box ref={inputRef} width={messageWidth}>
					<CommitMessageInput
						value={message}
						width={messageWidth}
						height={messageRows}
						placeholder="Commit Message"
						isDisabled={!isFocused}
						onChange={onMessageChange}
					/>
				</Box>
				<ToolbarButton label={menuLabel} onPress={onOpenMenu} />
			</Box>
			<Box flexDirection="row" width={contentWidth}>
				<Box width={authorWidth} flexShrink={0}>
					<Text wrap="truncate-end">
						<Text color={theme.dim}>{authorText}</Text>
						{hintText.length > 0 ? (
							<Text color={theme.dimmer}>
								{`${' '.repeat(hintGap)}${hintText}`}
							</Text>
						) : null}
						{authorFill}
					</Text>
				</Box>
				<ToolbarButton
					label={label}
					isDisabled={!isCommitReady}
					onPress={onCommit}
				/>
			</Box>
		</Box>
	);
}
