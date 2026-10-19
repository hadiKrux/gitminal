import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { theme } from '../theme.js';
import type { OperationLogEntry, OperationState } from '../hooks/use-repo.js';

type Props = {
	readonly operation: OperationState;
	/** Newest log entry; the console (ticket 03) renders the same entries. */
	readonly entry: OperationLogEntry | undefined;
	/** True while enter would open the error overlay; false while typing. */
	readonly hasDetailsHint: boolean;
};

/** Dim hint shown until the first operation runs. */
const idleHint = 'ready';

/** Leading space keeps the hint off the summary without spending a gap cell. */
const detailsHint = ' enter: details';

/** What a failed run says when git somehow produced no summary. */
const failedFallback = 'operation failed';

/**
 * Inline status indicator for the toolbar row.
 *
 * It renders only its content: the toolbar owns the flexible slot, so the
 * summary shrinks first while the details hint keeps its cells. A long failure
 * summary truncates instead of cutting the hint or pushing the toolbar
 * buttons. The states come from the newest operation-log entry, so this and
 * the ticket 03 console can never disagree.
 */
export default function StatusLine({
	operation,
	entry,
	hasDetailsHint,
}: Props) {
	if (operation.busy) {
		return (
			<Box flexDirection="row" flexGrow={1} flexShrink={1}>
				<Text wrap="truncate-end">
					<Spinner type="dots" /> {operation.label}
				</Text>
			</Box>
		);
	}

	if (entry?.status === 'failed') {
		return (
			<Box flexDirection="row" flexGrow={1} flexShrink={1}>
				<Box flexGrow={1} flexShrink={1}>
					<Text wrap="truncate-end" color={theme.del}>
						{entry.summary ?? failedFallback}
					</Text>
				</Box>
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

	if (entry?.status === 'ok') {
		return (
			<Box flexDirection="row" flexGrow={1} flexShrink={1}>
				<Text wrap="truncate-end" color={theme.success}>
					{entry.summary ?? 'done'}
				</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="row" flexGrow={1} flexShrink={1}>
			<Text color={theme.dim}>{idleHint}</Text>
		</Box>
	);
}
