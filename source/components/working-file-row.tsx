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

/** Width the two row actions occupy, including the gap between them. */
const actionsWidth = (stageLabel: string): number =>
	' Discard '.length + 1 + (stageLabel.length + 2);

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
	const labelWidth = Math.max(0, width - actionsWidth(stageLabel));
	const disclosure = isExpanded
		? icons.sectionExpanded
		: icons.sectionCollapsed;
	const pathRoom = Math.max(0, labelWidth - disclosure.length - 2);
	const path = truncate(file.path, pathRoom);
	const labelLength = disclosure.length + 2 + textWidth(path);
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
						{fill > 0 ? <Text>{' '.repeat(fill)}</Text> : null}
					</Text>
				</Box>
				<Box flexDirection="row" flexShrink={0} gap={1}>
					<ToolbarButton label="Discard" tone="danger" onPress={onDiscard} />
					<ToolbarButton label={stageLabel} onPress={onStage} />
				</Box>
			</Box>
			{isExpanded ? (
				<DiffView
					lines={file.diff}
					width={width}
					language={languageForPath(file.path)}
				/>
			) : null}
		</Box>
	);
}
