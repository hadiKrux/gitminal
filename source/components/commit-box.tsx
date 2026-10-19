import React, { useRef } from 'react';
import { Box, Text, type DOMElement } from 'ink';
import { useMouseClick } from '../hooks/use-mouse.js';
import { theme } from '../theme.js';
import { padToWidth, truncate } from '../layout.js';
import { useKeyboardShortcuts } from '../hooks/use-keyboard-shortcuts.js';
import { commitLabel } from '../labels.js';
import CommitMessageInput from './commit-message-input.js';
import ToolbarButton from './toolbar-button.js';

type Props = {
	readonly author: string;
	readonly width: number;
	readonly message: string;
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

/** Rows of the commit message area above the author line. */
const messageRows = 3;
/** The overflow button, shown as ` label ` in the toolbar. */
const menuLabel = '...';
const menuWidth = menuLabel.length + 2;
/** Total rows the commit box takes above the working tree. */
export const commitBoxHeight = messageRows + 1;

/**
 * The top of the commit panel: the commit message input, the author, and the
 * single commit action. Focus is explicit so the global letter shortcuts keep
 * working until the user clicks the input or presses the focus key.
 */
export default function CommitBox({
	author,
	width,
	message,
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
	const messageWidth = Math.max(1, width - menuWidth);

	useMouseClick(inputRef, onFocus);

	useKeyboardShortcuts(
		{
			'close-overlay': onBlur,
			commit() {
				if (stagedCount > 0) {
					onCommit();
				}
			},
		},
		{ isActive: isActive && isFocused },
	);

	const label = commitLabel(stagedCount);
	const authorWidth = Math.max(0, width - (label.length + 2));

	return (
		<Box flexDirection="column" width={width}>
			<Box flexDirection="row" width={width} alignItems="flex-start">
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
			<Box flexDirection="row" width={width}>
				<Text color={theme.dim} wrap="truncate-end">
					{padToWidth(truncate(author, authorWidth), authorWidth)}
				</Text>
				<ToolbarButton
					label={label}
					isDisabled={stagedCount === 0}
					onPress={onCommit}
				/>
			</Box>
		</Box>
	);
}
