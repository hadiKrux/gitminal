import React, { useState } from 'react';
import { theme } from '../theme.js';
import { truncate } from '../layout.js';
import { useKeyboardShortcuts } from '../hooks/use-keyboard-shortcuts.js';
import MenuRow from './menu-row.js';
import ModalFrame, {
	BlankRow,
	FrameRow,
	Line,
	contentWidth,
} from './modal-frame.js';

type Props = {
	/** What is being confirmed, e.g. `Discard` or `Discard All`. */
	readonly label: string;
	readonly paths: readonly string[];
	readonly onConfirm: () => void;
	readonly onCancel: () => void;
};

/** Path lines shown in full before the remainder is summarised. */
const maxPathRows = 6;

/** Cancel first: the default selection must be the one that changes nothing. */
const cancelIndex = 0;
const confirmIndex = 1;

/**
 * Confirmation shown before a discard that cannot be undone.
 *
 * It exists for untracked paths (no index copy to restore from) and for every
 * bulk discard. Escape and Cancel change nothing; enter on Discard runs the
 * requester's callback, which only the app invokes after closing this overlay.
 */
export default function ConfirmOverlay({
	label,
	paths,
	onConfirm,
	onCancel,
}: Props) {
	const [selected, setSelected] = useState(cancelIndex);

	useKeyboardShortcuts({
		'move-up'() {
			setSelected(current => Math.max(cancelIndex, current - 1));
		},
		'move-down'() {
			setSelected(current => Math.min(confirmIndex, current + 1));
		},
		'activate-selection'() {
			if (selected === confirmIndex) {
				onConfirm();
			} else {
				onCancel();
			}
		},
		'close-overlay': onCancel,
	});

	const shown = paths.slice(0, maxPathRows);
	const remaining = paths.length - shown.length;

	return (
		<ModalFrame title={label}>
			<FrameRow>
				<Line
					segments={[{ text: 'This cannot be undone.', color: theme.warn }]}
				/>
			</FrameRow>
			{shown.map((path, index) => (
				<FrameRow
					// eslint-disable-next-line react/no-array-index-key -- duplicate paths would collide, the index disambiguates
					key={`${path}-${index}`}
				>
					<Line
						segments={[
							{ text: truncate(path, contentWidth), color: theme.dim },
						]}
					/>
				</FrameRow>
			))}
			{remaining > 0 ? (
				<FrameRow>
					<Line
						segments={[
							{ text: `... and ${remaining} more`, color: theme.dimmer },
						]}
					/>
				</FrameRow>
			) : null}
			<BlankRow />
			<FrameRow>
				<MenuRow
					label="Cancel"
					width={contentWidth}
					isSelected={selected === cancelIndex}
					onPress={onCancel}
					onHover={() => {
						setSelected(cancelIndex);
					}}
				/>
			</FrameRow>
			<FrameRow>
				<MenuRow
					isDanger
					label="Discard"
					width={contentWidth}
					isSelected={selected === confirmIndex}
					onPress={onConfirm}
					onHover={() => {
						setSelected(confirmIndex);
					}}
				/>
			</FrameRow>
		</ModalFrame>
	);
}
