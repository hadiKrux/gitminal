import React, { useRef, useState } from 'react';
import { Box, Text, type DOMElement } from 'ink';
import Spinner from 'ink-spinner';
import { useMouseTarget } from '../hooks/use-mouse.js';
import { formatClockTime, sanitizeOutput } from '../data/format.js';
import { asciiBorder, theme } from '../theme.js';
import { textWidth, truncate } from '../layout.js';
import type { OperationLogEntry } from '../hooks/use-repo.js';
import ScrollableArea, {
	wheelStep,
	type ScrollableAreaHandle,
} from './scrollable-area.js';

type Props = {
	readonly entries: readonly OperationLogEntry[];
	readonly width: number;
	readonly height: number;
	readonly isActive: boolean;
	/** Opens the full error overlay for the entry that was clicked. */
	readonly onOpenError: (entry: OperationLogEntry) => void;
};

type RowProps = {
	readonly entry: OperationLogEntry;
	/** Inner content width, i.e. the panel width minus padding and scrollbar. */
	readonly width: number;
	readonly onOpenError: (entry: OperationLogEntry) => void;
};

/** `HH:MM:SS ` including the gap before the status. */
const clockWidth = 9;
/** `OK ` / `ERR` are three cells; the spinner is padded to the same width. */
const statusWidth = 3;
/** Clock, status, and the three separating cells before the label. */
const prefixWidth = clockWidth + statusWidth + 1;

/**
 * Captured text as one display line: control sequences stripped, then any
 * newline or tab collapsed so a pathological label or argv cannot grow the
 * row past the viewport's one-row contract.
 */
const singleLine = (text: string): string =>
	sanitizeOutput(text).replace(/\s+/g, ' ').trim();

/** Compact duration: milliseconds below a second, then tenths. */
const formatDuration = (entry: OperationLogEntry): string => {
	if (entry.endedAt === undefined) {
		return '';
	}

	const elapsed = Math.max(0, entry.endedAt - entry.startedAt);
	return elapsed < 1000
		? `${Math.round(elapsed)}ms`
		: `${(elapsed / 1000).toFixed(1)}s`;
};

/**
 * Quote one argv cell when it would otherwise read ambiguously.
 *
 * Paths containing whitespace (or an empty argument) are wrapped in double
 * quotes, with any embedded double quote backslash-escaped. That is enough for
 * the console's one-line display; it is not meant to be shell-replayable.
 */
const quoteArg = (arg: string): string =>
	arg.length === 0 || /\s/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg;

/** The first argv joined, plus a count when a chunked run spawned several. */
const commandLabel = (entry: OperationLogEntry): string => {
	const first = entry.args[0];
	if (first === undefined) {
		return '';
	}

	const joined = first.map(arg => quoteArg(arg)).join(' ');
	return entry.args.length > 1
		? `${joined} (+${entry.args.length - 1} more)`
		: joined;
};

/**
 * Exit code label for a failed run, empty when git was killed or never started
 * (a watcher degradation, for example, has a summary but no exit code).
 */
const exitLabel = (entry: OperationLogEntry): string =>
	entry.error?.exitCode === undefined ? '' : `exit ${entry.error.exitCode}`;

/**
 * The trailing cells of a row: elapsed time, and for a failure the exit code
 * and classified summary (raw output stays in the error overlay).
 */
const metaLabel = (entry: OperationLogEntry): string => {
	const duration = formatDuration(entry);
	if (entry.status !== 'failed') {
		return duration;
	}

	const summary = singleLine(entry.summary ?? '');
	return [duration, exitLabel(entry), summary].filter(Boolean).join(' ');
};

/**
 * One console row.
 *
 * Every cell is measured and truncated by hand so the row never wraps: time,
 * status, and label are the readable prefix, the command gives up cells first,
 * and the trailing metadata stays right-aligned. Padding the line to the full
 * content width makes the hover background cover the whole row.
 */
function ConsoleRow({ entry, width, onOpenError }: RowProps) {
	const rowRef = useRef<DOMElement>(null);
	const [isHovered, setIsHovered] = useState(false);

	const isRunning = entry.status === 'running';
	const isFailed = entry.status === 'failed';

	useMouseTarget(rowRef, {
		onHover: setIsHovered,
		...(isFailed
			? {
					onPress() {
						onOpenError(entry);
					},
			  }
			: {}),
	});

	const time = `${formatClockTime(entry.startedAt)} `;
	const label = singleLine(entry.label);
	const command = singleLine(commandLabel(entry));
	const meta = metaLabel(entry);

	// The label may take two fifths of the remaining row; the command gets
	// whatever is left after the metadata reserves its own share at the right.
	const available = Math.max(0, width - prefixWidth);
	const labelBudget = Math.min(
		textWidth(label),
		Math.max(0, Math.floor(available * 0.4)),
	);
	const shownLabel = truncate(label, labelBudget);
	let remaining = available - textWidth(shownLabel);

	const metaBudget = Math.max(0, Math.floor(width * 0.45));
	const shownMeta =
		remaining > 2 ? truncate(meta, Math.min(metaBudget, remaining - 2)) : '';
	const metaGap = textWidth(shownMeta) > 0 ? 2 : 0;
	remaining -= metaGap + textWidth(shownMeta);

	const commandGap = textWidth(command) > 0 && remaining > 2 ? 2 : 0;
	const shownCommand =
		commandGap > 0
			? truncate(command, Math.max(0, remaining - commandGap))
			: '';

	const used =
		prefixWidth +
		textWidth(shownLabel) +
		commandGap +
		textWidth(shownCommand) +
		metaGap +
		textWidth(shownMeta);
	const filler = Math.max(0, width - used);
	const background = isHovered ? theme.accentBg : undefined;

	return (
		<Box ref={rowRef} width={width} overflow="hidden">
			<Text backgroundColor={background} wrap="truncate-end">
				<Text color={theme.dimmer}>{time}</Text>
				{isRunning ? (
					<>
						<Spinner type="dots" />
						<Text>{'  '}</Text>
					</>
				) : (
					<Text color={isFailed ? theme.del : theme.success}>
						{isFailed ? 'ERR' : 'OK '}
					</Text>
				)}
				<Text> </Text>
				<Text color={isFailed ? theme.del : theme.text}>{shownLabel}</Text>
				{commandGap > 0 ? (
					<>
						<Text>{'  '}</Text>
						<Text color={theme.dim}>{shownCommand}</Text>
					</>
				) : null}
				{filler > 0 ? <Text>{' '.repeat(filler)}</Text> : null}
				{metaGap > 0 ? (
					<>
						<Text>{'  '}</Text>
						<Text color={isFailed ? theme.del : theme.success}>
							{shownMeta}
						</Text>
					</>
				) : null}
			</Text>
		</Box>
	);
}

/**
 * The non-modal operation console below the body.
 *
 * It is a normal flow panel, not an overlay: the rest of the UI stays visible
 * and interactive, while this area owns only its own wheel and (when active)
 * arrow/page keys. Failed rows are the one clickable row kind and open their
 * own error overlay; running and finished rows are inert.
 */
export default function ConsolePanel({
	entries,
	width,
	height,
	isActive,
	onOpenError,
}: Props) {
	const viewportHeight = Math.max(1, height - 1);
	const panelRef = useRef<DOMElement>(null);
	const scrollRef = useRef<ScrollableAreaHandle>(null);

	// The inner ScrollableArea owns its own rectangle; this target covers the
	// surrounding border and padding so the whole panel responds to the wheel.
	// The registry picks the innermost target, so a wheel over the rows is not
	// applied twice.
	useMouseTarget(panelRef, {
		onScroll(direction) {
			if (!isActive) {
				return;
			}

			scrollRef.current?.scrollBy(
				direction === 'scrolldown' ? wheelStep : -wheelStep,
			);
		},
	});

	return (
		<Box
			ref={panelRef}
			width={width}
			height={height}
			flexDirection="column"
			borderStyle={asciiBorder}
			borderBottom={false}
			borderLeft={false}
			borderRight={false}
			borderColor={theme.dimmer}
			paddingX={1}
		>
			<ScrollableArea
				ref={scrollRef}
				stickToBottom
				width={Math.max(0, width - 2)}
				height={viewportHeight}
				isActive={isActive}
				pageStep={Math.max(1, viewportHeight - 1)}
			>
				{contentWidth =>
					entries.length === 0 ? (
						<Text color={theme.dimmer}>no operations yet</Text>
					) : (
						// Direct children, one per entry: ScrollView measures each
						// child's height separately, so wrapping the rows in one
						// Box would make the whole log a single unmeasurable block.
						entries.map(entry => (
							<ConsoleRow
								key={entry.id}
								entry={entry}
								width={contentWidth}
								onOpenError={onOpenError}
							/>
						))
					)
				}
			</ScrollableArea>
		</Box>
	);
}
