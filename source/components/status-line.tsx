import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { ProgressBar, ThemeProvider, type Theme } from '@inkjs/ui';
import { theme } from '../theme.js';
import { textWidth, truncate } from '../layout.js';
import {
	watchUnavailableHint,
	type OperationLogEntry,
	type OperationState,
} from '../hooks/use-repo.js';

type Props = {
	readonly operation: OperationState;
	/** Newest log entry; the console (ticket 03) renders the same entries. */
	readonly entry: OperationLogEntry | undefined;
	/**
	 * True while live sync is degraded. Kept as state rather than inferred from
	 * the newest entry, so pressing `r` cannot replace the warning with a green
	 * "refreshed" while the watcher is still down.
	 */
	readonly isWatchDegraded: boolean;
	/** True while enter would open the error overlay; false while typing. */
	readonly hasDetailsHint: boolean;
	/** Short notice for a remote command ignored while the queue was busy. */
	readonly busyHint?: string;
	/** Cells the toolbar budgeted for this line; nothing may exceed it. */
	readonly width: number;
};

/** Dim hint shown until the first operation runs. */
const idleHint = 'ready';

/** Leading space keeps the hint off the summary without spending a gap cell. */
const detailsHint = ' enter: details';

/** What a failed run says when git somehow produced no summary. */
const failedFallback = 'operation failed';

/**
 * The progress bar's preferred cells. A wide slot gets the stable bar the
 * ticket asks for; a narrow one scales it down instead of spending cells it
 * does not have.
 */
const progressBarWidth = 20;

/** Below this a scaled bar is less readable than the spinner fallback. */
const minProgressBarWidth = 6;

/** Spinner glyph plus the space before the phase text. */
const spinnerWidth = 2;

/**
 * The `@inkjs/ui` progress bar defaults to magenta block figures, which are
 * both off-palette and untypable on a standard keyboard. This theme keeps the
 * bar inside the repo tokens and draws it with `#` and `-`; the width is a
 * parameter so the bar shrinks with the status slot.
 */
const progressThemeFor = (barWidth: number): Theme => ({
	components: {
		ProgressBar: {
			styles: {
				container: () => ({ width: barWidth, flexShrink: 0 }),
				completed: () => ({ color: theme.accent }),
				remaining: () => ({ color: theme.dimmer }),
			},
			config: () => ({ completedCharacter: '#', remainingCharacter: '-' }),
		},
	},
});

/**
 * The ignored-click notice.
 *
 * It is rendered after the primary line in every branch, not only while an
 * operation is running: a click during the drain load after a run settled has
 * `operation.busy` false, and the user still needs visible feedback. The box
 * may shrink, so a narrow terminal truncates the notice instead of overflowing.
 */
function BusyHint({ text }: { readonly text: string | undefined }) {
	if (text === undefined) {
		return null;
	}

	return (
		<Box flexShrink={1} marginLeft={1}>
			<Text wrap="truncate-end" color={theme.warn}>
				{text}
			</Text>
		</Box>
	);
}

/**
 * Inline status indicator for the toolbar row.
 *
 * It renders only its content, inside the width the toolbar budgeted: the
 * summary and phase shrink first while the details hint keeps its cells, and
 * the progress bar scales down or falls back to the spinner when the slot is
 * too narrow. Runs come from the newest operation-log entry; the watch warning
 * comes from its own sticky state, so it survives the refresh row `r` adds.
 * While a run streams progress the same row becomes a bar plus the phase, and
 * an ignored remote click appends its warning without displacing the running
 * operation or a failure.
 */
export default function StatusLine({
	operation,
	entry,
	isWatchDegraded,
	hasDetailsHint,
	busyHint,
	width,
}: Props) {
	const hintWidth = busyHint === undefined ? 0 : textWidth(busyHint) + 1;
	const progressWidth = Math.max(0, width - hintWidth);

	if (operation.busy) {
		const { progress } = operation;
		const percent = progress?.percent;
		const phaseText =
			progress !== undefined && percent !== undefined
				? `${progress.phase} ${percent}%`
				: undefined;
		const label = phaseText ?? progress?.phase ?? operation.label;
		const barWidth =
			phaseText === undefined
				? 0
				: Math.min(progressBarWidth, progressWidth - textWidth(phaseText) - 1);
		const showBar = barWidth >= minProgressBarWidth;

		return (
			<Box flexDirection="row" width={width} flexShrink={1} overflow="hidden">
				<Box
					flexDirection="row"
					width={progressWidth}
					flexShrink={1}
					overflow="hidden"
				>
					{showBar ? (
						<>
							<ThemeProvider theme={progressThemeFor(barWidth)}>
								<ProgressBar value={percent ?? 0} />
							</ThemeProvider>
							<Box flexShrink={1} marginLeft={1}>
								<Text wrap="truncate-end">
									{truncate(
										phaseText ?? '',
										Math.max(0, progressWidth - barWidth - 1),
									)}
								</Text>
							</Box>
						</>
					) : (
						<Box flexShrink={1}>
							<Text wrap="truncate-end">
								<Spinner type="dots" />{' '}
								{truncate(label, Math.max(0, progressWidth - spinnerWidth))}
							</Text>
						</Box>
					)}
				</Box>
				<BusyHint text={busyHint} />
			</Box>
		);
	}

	if (entry?.status === 'failed') {
		return (
			<Box flexDirection="row" width={width} flexShrink={1} overflow="hidden">
				<Box flexGrow={1} flexShrink={1}>
					<Text wrap="truncate-end" color={theme.del}>
						{entry.summary ?? failedFallback}
					</Text>
				</Box>
				<BusyHint text={busyHint} />
				{hasDetailsHint ? (
					// `Text` takes no layout props in Ink, so the non-shrinking
					// tail is a box that never gives up the hint's cells.
					<Box flexShrink={0}>
						<Text color={theme.dim}>{detailsHint}</Text>
					</Box>
				) : null}
			</Box>
		);
	}

	/*
	 * Degradation outlives the newest log entry: `r` appends a successful
	 * refresh row, and only this state keeps telling the user that live sync
	 * is still unavailable. A newer failed run above takes precedence, so the
	 * line never claims success while offering stale details.
	 */
	if (isWatchDegraded) {
		return (
			<Box flexDirection="row" width={width} flexShrink={1} overflow="hidden">
				<Box flexGrow={1} flexShrink={1}>
					<Text wrap="truncate-end" color={theme.warn}>
						{watchUnavailableHint}
					</Text>
				</Box>
				<BusyHint text={busyHint} />
				{hasDetailsHint ? (
					<Box flexShrink={0}>
						<Text color={theme.dim}>{detailsHint}</Text>
					</Box>
				) : null}
			</Box>
		);
	}

	if (entry?.status === 'ok') {
		return (
			<Box flexDirection="row" width={width} flexShrink={1} overflow="hidden">
				<Box flexGrow={1} flexShrink={1}>
					<Text wrap="truncate-end" color={theme.success}>
						{entry.summary ?? 'done'}
					</Text>
				</Box>
				<BusyHint text={busyHint} />
			</Box>
		);
	}

	return (
		<Box flexDirection="row" width={width} flexShrink={1} overflow="hidden">
			<Text color={theme.dim}>{idleHint}</Text>
			<BusyHint text={busyHint} />
		</Box>
	);
}
