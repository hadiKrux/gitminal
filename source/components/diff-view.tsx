import React, { useRef, useState } from 'react';
import { Box, Text, type DOMElement } from 'ink';
import SyntaxHighlight from 'ink-syntax-highlight';
import { useMouseTarget } from '../hooks/use-mouse.js';
import { theme, syntaxTheme } from '../theme.js';
import { textWidth, truncate } from '../layout.js';
import type { DiffLine, DiffLineKind } from '../data/types.js';

type Props = {
	readonly lines: readonly DiffLine[];
	readonly width: number;
	/** Highlighter language for the file, or undefined to show plain text. */
	readonly language?: string;
	/** Collapses the owning row; without it header rows are inert. */
	readonly onCollapse?: () => void;
};

type RowProps = {
	readonly line: DiffLine;
	readonly width: number;
	readonly language: string | undefined;
	readonly onCollapse: (() => void) | undefined;
};

/** Columns reserved for each side of the old/new line-number gutter. */
const numberWidth = 3;

/** Tabs have no fixed terminal width, so they are expanded to spaces. */
const tabSpaces = '    ';

type LineStyle = {
	readonly backgroundColor: string;
	readonly foreground: string;
	readonly gutter: string;
};

const styleFor = (kind: DiffLineKind): LineStyle => {
	switch (kind) {
		case 'add': {
			return {
				backgroundColor: theme.diffAddBg,
				foreground: theme.codeText,
				gutter: theme.add,
			};
		}

		case 'del': {
			return {
				backgroundColor: theme.diffDelBg,
				foreground: theme.codeText,
				gutter: theme.del,
			};
		}

		case 'header': {
			return {
				backgroundColor: theme.bgAlt,
				foreground: theme.dim,
				gutter: theme.dimmer,
			};
		}

		default: {
			return {
				backgroundColor: theme.codeBg,
				foreground: theme.codeText,
				gutter: theme.codeGutterFg,
			};
		}
	}
};

const padNumber = (value: number | undefined): string =>
	value === undefined
		? ' '.repeat(numberWidth)
		: String(value).padStart(numberWidth);

/**
 * One diff row.
 *
 * A separate component because the header hover/click handling needs hooks,
 * and hooks cannot run inside the `lines.map` callback. Body lines register no
 * handlers: a click on code must never collapse the row that contains it.
 */
function DiffRow({ line, width, language, onCollapse }: RowProps) {
	const rowRef = useRef<DOMElement>(null);
	const [isHovered, setIsHovered] = useState(false);
	const isHeader = line.kind === 'header';

	useMouseTarget(rowRef, {
		...(isHeader && onCollapse !== undefined
			? {
					onHover: setIsHovered,
					onPress: onCollapse,
			  }
			: {}),
	});

	const style = styleFor(line.kind);
	const gutter = isHeader
		? ''
		: `${padNumber(line.oldNumber)} ${padNumber(line.newNumber)} `;
	const text = truncate(
		line.text.replaceAll('\t', tabSpaces),
		Math.max(0, width - gutter.length),
	);
	const fill = Math.max(0, width - gutter.length - textWidth(text));
	const isCode = !isHeader && language !== undefined && text.length > 0;
	const background =
		isHeader && isHovered ? theme.accentBg : style.backgroundColor;

	return (
		<Box ref={rowRef} width={width}>
			{/*
			 * Header rows highlight on hover because the whole row is the click
			 * target that collapses the file; body rows stay inert.
			 */}
			<Text backgroundColor={background} wrap="truncate-end">
				{gutter.length > 0 ? <Text color={style.gutter}>{gutter}</Text> : null}
				{isCode ? (
					<SyntaxHighlight
						code={text}
						language={language}
						theme={syntaxTheme}
					/>
				) : (
					<Text color={style.foreground} bold={isHeader}>
						{text}
					</Text>
				)}
				{fill > 0 ? <Text>{' '.repeat(fill)}</Text> : null}
			</Text>
		</Box>
	);
}

/**
 * A unified diff, one terminal row per line.
 *
 * Added and removed rows sit on a softened block of green or red that spans the
 * row, so the change reads at a glance without the glare of a full-strength
 * fill. Code is syntax highlighted per line, which keeps each row's background
 * intact; headers carry no line numbers and render as a quiet band.
 *
 * The rows render at full height inside the file list. The list is the single
 * scroll surface, so the wheel and the arrow keys both scroll it.
 */
export default function DiffView({
	lines,
	width,
	language,
	onCollapse,
}: Props) {
	if (lines.length === 0) {
		return null;
	}

	return (
		<Box flexDirection="column" width={width}>
			{lines.map((line, index) => (
				<DiffRow
					// The composite identity keeps a patched line from reusing
					// the wrong highlighted row; the index keeps it unique.
					// eslint-disable-next-line react/no-array-index-key
					key={`${line.kind}:${line.oldNumber ?? ''}:${
						line.newNumber ?? ''
					}:${index}`}
					line={line}
					width={width}
					language={language}
					onCollapse={onCollapse}
				/>
			))}
		</Box>
	);
}
