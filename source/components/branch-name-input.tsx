import React from 'react';
import { useKeyboardShortcuts } from '../hooks/use-keyboard-shortcuts.js';
import { theme } from '../theme.js';
import ModalFrame, {
	BlankRow,
	FrameRow,
	Line,
	Rule,
	contentWidth,
} from './modal-frame.js';
import SingleLineInput from './single-line-input.js';

type Props = {
	readonly onSubmit: (name: string) => void;
	readonly onCancel: () => void;
};

/**
 * The new-branch form.
 *
 * Validation belongs to `git/branch.ts`, so the field only collects the name:
 * a rejected name travels through the operation log and the error overlay,
 * where git's own message explains exactly which rule it broke. Escape cancels
 * without creating anything; enter submits.
 */
export default function BranchNameInput({ onSubmit, onCancel }: Props) {
	useKeyboardShortcuts({ 'close-overlay': onCancel });

	return (
		<ModalFrame title="New branch">
			<FrameRow>
				<Line
					segments={[
						{
							text: 'create and switch to a new branch',
							color: theme.dim,
						},
					]}
				/>
			</FrameRow>
			<BlankRow />
			<FrameRow>
				<SingleLineInput
					width={contentWidth}
					placeholder="branch name"
					onSubmit={value => {
						const trimmed = value.trim();
						if (trimmed.length === 0) {
							return;
						}

						onSubmit(trimmed);
					}}
				/>
			</FrameRow>
			<BlankRow />
			<FrameRow>
				<Rule />
			</FrameRow>
			<FrameRow>
				<Line
					segments={[
						{ text: 'enter', color: theme.accent, isBold: true },
						{ text: ' create   ', color: theme.dim },
						{ text: 'esc', color: theme.accent, isBold: true },
						{ text: ' cancel', color: theme.dim },
					]}
				/>
			</FrameRow>
		</ModalFrame>
	);
}
