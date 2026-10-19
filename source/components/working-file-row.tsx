import React, { useRef } from 'react';
import { Box, Text, type DOMElement } from 'ink';
import { useMouseClick } from '../hooks/use-mouse.js';
import { theme } from '../theme.js';
import { icons } from '../icons.js';
import { textWidth, truncate } from '../layout.js';
import type { WorkingFile, WorkingFileStatus } from '../data/types.js';
import { languageForPath } from '../data/language.js';
import DiffView from './diff-view.js';
import ToolbarButton from './toolbar-button.js';

type Props = {
	readonly file: WorkingFile;
	readonly width: number;
	readonly isExpanded: boolean;
	readonly isStaged: boolean;
	readonly onToggle: () => void;
	readonly onDiscard: () => void;
	readonly onStage: () => void;
};

const statusLabel = (status: WorkingFileStatus): string => {
	switch (status) {
		case 'added': {
			return 'A';
		}

		case 'deleted': {
			return 'D';
		}

		case 'untracked': {
			return '?';
		}

		case 'conflicted': {
			return 'U';
		}

		case 'renamed': {
			return 'R';
		}

		case 'typechange': {
			return 'T';
		}

		default: {
			return 'M';
		}
	}
};

const statusColor = (status: WorkingFileStatus): string => {
	switch (status) {
		case 'added':
		case 'untracked': {
			return theme.add;
		}

		case 'deleted':
		case 'conflicted': {
			return theme.del;
		}

		default: {
			return theme.text;
		}
	}
};

/**
 * Width the row actions occupy, including the gap between them.
 *
 * The Discard button only exists while the file has a worktree change; without
 * that, `git restore --worktree` would exit 0 without changing anything, so the
 * label gets the freed columns instead.
 */
const actionsWidth = (stageLabel: string, hasDiscard: boolean): number =>
	stageLabel.length + 2 + (hasDiscard ? ' Discard '.length + 1 : 0);

/**
 * The row's change summary: numstat counts, or git's binary marker.
 *
 * Zero/zero is not a change worth summarizing (a directory row, or a diff that
 * has not loaded yet), so the chip is omitted entirely. When either side is
 * non-zero both numbers render, which keeps the chip's shape stable.
 */
const changeChip = (file: WorkingFile): string | undefined => {
	if (file.binary) {
		return 'binary file changed';
	}

	if (file.additions === 0 && file.deletions === 0) {
		return undefined;
	}

	return `+${file.additions} -${file.deletions}`;
};

/**
 * A working-tree file row.
 *
 * The left side toggles the file's diff, while the actions stay independent so
 * a click never expands a file by accident.
 */
export default function WorkingFileRow({
	file,
	width,
	isExpanded,
	isStaged,
	onToggle,
	onDiscard,
	onStage,
}: Props) {
	const rowRef = useRef<DOMElement>(null);

	useMouseClick(rowRef, onToggle);

	const stageLabel = isStaged ? 'Unstage' : 'Stage';
	// Matches the group header's rule: no worktree change, no Discard.
	const hasDiscard = file.hasUnstaged;
	const labelWidth = Math.max(0, width - actionsWidth(stageLabel, hasDiscard));
	const disclosure = isExpanded
		? icons.sectionExpanded
		: icons.sectionCollapsed;
	const chipLabel = changeChip(file);
	// At most half the label: on a narrow panel the path must stay visible
	// instead of being fully displaced by a clipped count. Truncation cuts on
	// grapheme boundaries, so "binary file changed" degrades without breaking
	// the row width or the trailing fill.
	const chipRoom =
		chipLabel === undefined
			? 0
			: Math.min(textWidth(chipLabel), Math.max(0, Math.floor(labelWidth / 2)));
	const chip = chipLabel === undefined ? '' : truncate(chipLabel, chipRoom);
	const chipGap = textWidth(chip) > 0 ? 1 : 0;
	const pathRoom = Math.max(
		0,
		labelWidth - disclosure.length - 2 - chipGap - textWidth(chip),
	);
	const path = truncate(file.path, pathRoom);
	const labelLength =
		disclosure.length + 2 + textWidth(path) + chipGap + textWidth(chip);
	const fill = Math.max(0, labelWidth - labelLength);
	const background = isExpanded ? theme.accentBg : undefined;

	return (
		<Box flexDirection="column">
			<Box flexDirection="row" width={width}>
				<Box ref={rowRef} width={labelWidth} flexShrink={0}>
					<Text backgroundColor={background} wrap="truncate-end">
						<Text color={theme.dimmer}>{disclosure}</Text>
						{isStaged ? (
							<Text backgroundColor={theme.addBg} color={theme.addText}>
								{statusLabel(file.status)}
							</Text>
						) : (
							<Text color={statusColor(file.status)}>
								{statusLabel(file.status)}
							</Text>
						)}
						<Text color={theme.text}>{` ${path}`}</Text>
						{chipGap > 0 ? (
							<>
								<Text> </Text>
								<Text color={file.binary ? theme.dimmer : theme.dim}>
									{chip}
								</Text>
							</>
						) : null}
						{fill > 0 ? <Text>{' '.repeat(fill)}</Text> : null}
					</Text>
				</Box>
				<Box flexDirection="row" flexShrink={0} gap={1}>
					{hasDiscard ? (
						<ToolbarButton label="Discard" tone="danger" onPress={onDiscard} />
					) : null}
					<ToolbarButton label={stageLabel} onPress={onStage} />
				</Box>
			</Box>
			{isExpanded ? (
				<DiffView
					lines={file.diff}
					width={width}
					language={languageForPath(file.path)}
					onCollapse={onToggle}
				/>
			) : null}
		</Box>
	);
}
