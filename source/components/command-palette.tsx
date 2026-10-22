import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, type DOMElement } from 'ink';
import {
	commands,
	type AppCommand,
	type CommandAvailability,
	type CommandId,
} from '../commands.js';
import { useKeyboardShortcuts } from '../hooks/use-keyboard-shortcuts.js';
import {
	useMouseClick,
	useMouseHover,
	useMouseTarget,
} from '../hooks/use-mouse.js';
import { padToWidth, textWidth, truncate } from '../layout.js';
import { theme } from '../theme.js';
import SingleLineInput from './single-line-input.js';
import ModalFrame, {
	BlankRow,
	FrameRow,
	Line,
	Rule,
	useContentWidth,
} from './modal-frame.js';

type Props = {
	/** Terminal height, used to cap the row list to the visible screen. */
	readonly rows: number;
	/** Recently run commands, newest first; optional for a fresh session. */
	readonly recentCommandIds?: readonly CommandId[];
	readonly availability: CommandAvailability;
	readonly onRun: (id: CommandId) => void;
	readonly onClose: () => void;
};

/**
 * Rows the modal spends outside the command list.
 *
 * Four for the frame (two borders and two blank padding rows), then the query
 * row, the gap below it, the rule, and the footer. Keeping the list within
 * `rows - 8` stops a long catalog from pushing the frame off the screen.
 */
const paletteChromeRows = 8;

/**
 * Height below which the decorative rows are dropped.
 *
 * The frame, query, and at least one result must always fit. On a short
 * terminal the spacing blank row, rule, and footer give up their rows first;
 * the query and the results are what the palette exists for.
 */
const compactRowsThreshold = 18;
const compactChromeRows = 5;

/** Space the label is guaranteed before a long reason is truncated. */
const minLabelWidth = 11;

/** Blank cells kept between the label and the right-aligned meta column. */
const labelMetaGap = 1;

/** Lower tier means a better match. */
const matchTier = {
	prefix: 0,
	substring: 1,
	subsequence: 2,
	section: 3,
} as const;

/** Where a subsequence match starts and how many cells it skips. */
type MatchPosition = {
	readonly start: number;
	readonly gaps: number;
};

/**
 * Match `needle` in `haystack` in order and report the first position.
 *
 * `gaps` counts the skipped cells between matched characters, so a tighter
 * match ranks ahead of one that scatters the same characters across the
 * string. Both inputs are already lowered by the caller.
 */
const matchSubsequence = (
	needle: string,
	haystack: string,
): MatchPosition | undefined => {
	let matched = 0;
	let index = -1;
	let start = -1;
	let previous = -1;
	let gaps = 0;

	for (const character of haystack) {
		index += 1;
		if (character !== needle[matched]) {
			continue;
		}

		if (start === -1) {
			start = index;
		} else {
			gaps += index - previous - 1;
		}

		previous = index;
		matched += 1;

		if (matched === needle.length) {
			return { start, gaps };
		}
	}

	return undefined;
};

type RankedCommand = {
	readonly command: AppCommand;
	readonly tier: number;
	readonly start: number;
	readonly gaps: number;
	/** Position in the recency list; unbounded when the command was not run. */
	readonly recentRank: number;
	readonly catalogIndex: number;
};

/**
 * Rank one command against the needle.
 *
 * The label is preferred at every strength before the section: a prefix beats
 * a substring, which beats a scattered subsequence, and only a command whose
 * label misses entirely is matched through its section.
 */
const rankCommand = (
	command: AppCommand,
	needle: string,
	recentRank: number,
	catalogIndex: number,
): RankedCommand | undefined => {
	const label = command.label.toLowerCase();
	const labelStart = label.indexOf(needle);

	if (labelStart === 0) {
		return {
			command,
			tier: matchTier.prefix,
			start: 0,
			gaps: 0,
			recentRank,
			catalogIndex,
		};
	}

	if (labelStart > 0) {
		return {
			command,
			tier: matchTier.substring,
			start: labelStart,
			gaps: 0,
			recentRank,
			catalogIndex,
		};
	}

	const labelMatch = matchSubsequence(needle, label);
	if (labelMatch !== undefined) {
		return {
			command,
			tier: matchTier.subsequence,
			start: labelMatch.start,
			gaps: labelMatch.gaps,
			recentRank,
			catalogIndex,
		};
	}

	if (matchSubsequence(needle, command.section.toLowerCase()) !== undefined) {
		return {
			command,
			tier: matchTier.section,
			start: 0,
			gaps: 0,
			recentRank,
			catalogIndex,
		};
	}

	return undefined;
};

const compareRanked = (left: RankedCommand, right: RankedCommand): number => {
	if (left.tier !== right.tier) {
		return left.tier - right.tier;
	}

	if (left.tier === matchTier.subsequence && left.gaps !== right.gaps) {
		return left.gaps - right.gaps;
	}

	if (left.start !== right.start) {
		return left.start - right.start;
	}

	// Recency is a tie-breaker only: a better match tier, a tighter
	// subsequence, or an earlier match position always wins first. An explicit
	// comparison instead of subtraction: an unrun command's rank is Infinity,
	// and `Infinity - Infinity` is NaN, which a comparator must never return.
	if (left.recentRank !== right.recentRank) {
		return left.recentRank < right.recentRank ? -1 : 1;
	}

	return left.catalogIndex - right.catalogIndex;
};

/**
 * Case-insensitive match over the label and the section, best match first.
 *
 * `sta` finds `stage all` as a label prefix, `unstage all` as a later
 * substring, and `switch branch` as a scattered label subsequence, while
 * `work` finds every Working Tree command through its section. An empty query
 * lists recently run commands first, then catalog order. With a query, recent
 * commands break ties inside the same match tier without ever outranking a
 * better match.
 */
export const filterCommands = (
	query: string,
	recentCommandIds: readonly CommandId[] = [],
): readonly AppCommand[] => {
	const needle = query.trim().toLowerCase();

	if (needle.length === 0) {
		const byId = new Map(commands.map(command => [command.id, command]));
		const recent = recentCommandIds.flatMap(id => {
			const command = byId.get(id);
			return command === undefined ? [] : [command];
		});
		const shown = new Set(recent.map(command => command.id));

		return [...recent, ...commands.filter(command => !shown.has(command.id))];
	}

	const recentRankOf = (id: CommandId): number => {
		const index = recentCommandIds.indexOf(id);
		return index === -1 ? Number.POSITIVE_INFINITY : index;
	};

	return commands
		.map((command, catalogIndex) =>
			rankCommand(command, needle, recentRankOf(command.id), catalogIndex),
		)
		.filter((match): match is RankedCommand => match !== undefined)
		.sort((left, right) => compareRanked(left, right))
		.map(match => match.command);
};

const disabledReasonOf = (
	command: AppCommand,
	availability: CommandAvailability,
): string | undefined => command.enabledWhen?.(availability);

const firstEnabledId = (
	matches: readonly AppCommand[],
	availability: CommandAvailability,
): CommandId | undefined =>
	matches.find(command => disabledReasonOf(command, availability) === undefined)
		?.id;

const labelColorOf = (
	isSelected: boolean,
	isDisabled: boolean,
	isDanger: boolean,
): string => {
	if (isSelected) {
		return theme.bg;
	}

	if (isDisabled) {
		return theme.dimmer;
	}

	return isDanger ? theme.del : theme.dim;
};

type PaletteRowProps = {
	readonly command: AppCommand;
	/** Content width of the row, excluding the frame. */
	readonly width: number;
	readonly isSelected: boolean;
	readonly disabledReason: string | undefined;
	readonly onRun: () => void;
	readonly onHover: () => void;
};

/**
 * One command row: cursor, label, and a right-aligned section or reason.
 *
 * The meta column is sized per row and anchored to the right edge, so section
 * names line up while a disabled row can use the space its shorter label
 * leaves for the reason. Disabled rows are dimmed and their hover and click
 * handlers are inert.
 */
function PaletteRow({
	command,
	width,
	isSelected,
	disabledReason,
	onRun,
	onHover,
}: PaletteRowProps) {
	const ref = useRef<DOMElement>(null);
	const isDisabled = disabledReason !== undefined;

	useMouseHover(ref, isHovered => {
		if (isHovered && !isDisabled) {
			onHover();
		}
	});

	useMouseClick(ref, () => {
		if (!isDisabled) {
			onRun();
		}
	});

	const meta = disabledReason ?? command.section;
	const shownMeta = truncate(
		meta,
		Math.max(0, width - 2 - labelMetaGap - minLabelWidth),
	);
	const metaWidth = textWidth(shownMeta);
	// A blank column keeps a truncated label from butting against the reason;
	// with no meta there is nothing to separate, so the label keeps the space.
	const gapWidth = metaWidth > 0 ? labelMetaGap : 0;
	const labelWidth = Math.max(0, width - 2 - gapWidth - metaWidth);
	const background = isSelected ? theme.accent : theme.bgPanel;
	const cursor = isSelected ? '>' : ' ';
	const cursorColor = isSelected ? theme.bg : theme.dim;
	const metaColor = isSelected
		? theme.bg
		: isDisabled
		? theme.dimmer
		: theme.dim;

	return (
		<Box ref={ref} flexDirection="row">
			<Text backgroundColor={background} color={cursorColor}>
				{`${cursor} `}
			</Text>
			<Text
				bold={isSelected}
				backgroundColor={background}
				color={labelColorOf(isSelected, isDisabled, command.isDanger === true)}
				wrap="truncate-end"
			>
				{padToWidth(command.label, labelWidth)}
			</Text>
			<Text backgroundColor={background}>{' '.repeat(gapWidth)}</Text>
			<Text backgroundColor={background} color={metaColor} wrap="truncate-end">
				{shownMeta}
			</Text>
		</Box>
	);
}

/**
 * The app-wide command palette.
 *
 * Ctrl+P opens it over the whole catalog. Typing filters, arrows move between
 * enabled rows (disabled ones are skipped), enter runs the highlighted entry,
 * and escape or ctrl+p closes it. The query field is `SingleLineInput`, and
 * only the visible rows are mounted so a row can never paint over the frame.
 */
export default function CommandPalette({
	rows,
	recentCommandIds = [],
	availability,
	onRun,
	onClose,
}: Props) {
	const [query, setQuery] = useState('');
	const contentWidth = useContentWidth();
	const matches = useMemo(
		() => filterCommands(query, recentCommandIds),
		[query, recentCommandIds],
	);
	const [selectedId, setSelectedId] = useState<CommandId | undefined>(() =>
		firstEnabledId(filterCommands('', recentCommandIds), availability),
	);

	const selectedIndex = matches.findIndex(
		command =>
			command.id === selectedId &&
			disabledReasonOf(command, availability) === undefined,
	);
	const firstEnabledIndex = matches.findIndex(
		command => disabledReasonOf(command, availability) === undefined,
	);
	const activeIndex = selectedIndex === -1 ? firstEnabledIndex : selectedIndex;
	const activeCommand = activeIndex === -1 ? undefined : matches[activeIndex];
	const activeId = activeCommand?.id;

	const isCompact = rows < compactRowsThreshold;
	const chromeRows = isCompact ? compactChromeRows : paletteChromeRows;
	const listHeight = Math.max(1, Math.min(matches.length, rows - chromeRows));
	const maxOffset = Math.max(0, matches.length - listHeight);

	const [scrollOffset, setScrollOffset] = useState(0);
	const rowsRef = useRef<DOMElement>(null);
	const previousQuery = useRef(query);

	// Availability can change while the palette is open (a refresh landing
	// behind it); keep the highlight on an enabled row and write the fallback
	// back so later moves start from what is rendered.
	useEffect(() => {
		if (activeId !== undefined && activeId !== selectedId) {
			setSelectedId(activeId);
		}
	}, [activeId, selectedId]);

	// Keep the active row inside the visible window with the smallest scroll.
	// A new query also restarts from the top, because the rows it shows are a
	// different list even when the numeric selection happens to match.
	useEffect(() => {
		const isNewQuery = previousQuery.current !== query;
		previousQuery.current = query;

		setScrollOffset(current => {
			const base = isNewQuery ? 0 : Math.min(current, maxOffset);

			if (activeIndex < 0) {
				return base;
			}

			if (activeIndex < base) {
				return activeIndex;
			}

			if (activeIndex >= base + listHeight) {
				return Math.max(0, Math.min(activeIndex - listHeight + 1, maxOffset));
			}

			return base;
		});
	}, [activeIndex, listHeight, maxOffset, query]);

	/**
	 * Every query change selects the first enabled match. That is deliberately
	 * different from keeping the previous row: typing narrows the list, so the
	 * old selection may be filtered out and the first result is what enter
	 * should run.
	 */
	const changeQuery = (value: string): void => {
		setQuery(value);
		setSelectedId(
			firstEnabledId(filterCommands(value, recentCommandIds), availability),
		);
	};

	const move = (delta: number): void => {
		let index = activeIndex;

		for (;;) {
			index += delta;
			if (index < 0 || index >= matches.length) {
				return;
			}

			const candidate = matches[index];
			if (
				candidate !== undefined &&
				disabledReasonOf(candidate, availability) === undefined
			) {
				setSelectedId(candidate.id);
				return;
			}
		}
	};

	const runSelected = (): void => {
		if (activeCommand === undefined) {
			return;
		}

		if (disabledReasonOf(activeCommand, availability) !== undefined) {
			return;
		}

		onRun(activeCommand.id);
	};

	useKeyboardShortcuts({
		'move-down'() {
			move(1);
		},
		'move-up'() {
			move(-1);
		},
		'close-overlay': onClose,
		// The same key that opened the palette closes it; enter stays owned by
		// SingleLineInput so its submit path is the only one that runs a row.
		'open-command-palette': onClose,
	});

	// The wheel only reaches the rows: the wrapper is the sole scroll target,
	// so the query, frame, and footer stay inert under the pointer. One row per
	// event keeps a physical notch from jumping past a command.
	useMouseTarget(rowsRef, {
		onScroll(direction) {
			setScrollOffset(current =>
				Math.max(
					0,
					Math.min(current + (direction === 'scrolldown' ? 1 : -1), maxOffset),
				),
			);
		},
	});

	const offset = Math.min(scrollOffset, maxOffset);
	const visibleCommands = matches.slice(offset, offset + listHeight);

	return (
		<ModalFrame title="Command Palette">
			<FrameRow>
				<SingleLineInput
					width={contentWidth}
					placeholder="type to filter commands"
					onChange={changeQuery}
					onSubmit={runSelected}
				/>
			</FrameRow>
			{isCompact ? null : <BlankRow />}
			{matches.length === 0 ? (
				<FrameRow>
					<Line
						segments={[{ text: 'no matching commands', color: theme.dimmer }]}
					/>
				</FrameRow>
			) : (
				<Box ref={rowsRef} flexDirection="column">
					{visibleCommands.map(command => {
						const disabledReason = disabledReasonOf(command, availability);

						return (
							<FrameRow key={command.id}>
								<PaletteRow
									command={command}
									width={contentWidth}
									isSelected={command.id === activeId}
									disabledReason={disabledReason}
									onRun={() => {
										onRun(command.id);
									}}
									onHover={() => {
										setSelectedId(command.id);
									}}
								/>
							</FrameRow>
						);
					})}
				</Box>
			)}
			{isCompact ? null : (
				<>
					<FrameRow>
						<Rule />
					</FrameRow>
					<FrameRow>
						<Line
							segments={[
								{ text: 'enter', color: theme.accent, isBold: true },
								{ text: ' run   ', color: theme.dim },
								{ text: 'esc', color: theme.accent, isBold: true },
								{ text: ' close   ', color: theme.dim },
								{ text: 'ctrl+p', color: theme.accent, isBold: true },
								{ text: ' close', color: theme.dim },
							]}
						/>
					</FrameRow>
				</>
			)}
		</ModalFrame>
	);
}
