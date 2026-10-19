import React from 'react';
import { Box, Text } from 'ink';
import SyntaxHighlight from 'ink-syntax-highlight';
import { theme, syntaxTheme } from '../theme.js';
import { textWidth, truncate } from '../layout.js';
import type { DiffLine, DiffLineKind } from '../data/types.js';

type Props = {
	readonly lines: readonly DiffLine[];
	readonly width: number;
	/** Highlighter language for the file, or undefined to show plain text. */
	readonly language?: string;
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
 * A unified diff, one terminal row per line.
 *
 * Added and removed rows sit on a softened block of green or red that spans the
 * row, so the change reads at a glance without the glare of a full-strength
 * fill. Code is syntax highlighted per line, which keeps each row's background
 * intact; headers carry no line numbers and render as a quiet band.
 */
export default function DiffView({ lines, width, language }: Props) {
	return (
		<Box flexDirection="column" width={width}>
			{lines.map((line, index) => {
				const style = styleFor(line.kind);
				const isHeader = line.kind === 'header';
				const gutter = isHeader
					? ''
					: `${padNumber(line.oldNumber)} ${padNumber(line.newNumber)} `;
				const text = truncate(
					line.text.replaceAll('\t', tabSpaces),
					Math.max(0, width - gutter.length),
				);
				const fill = Math.max(0, width - gutter.length - textWidth(text));
				const isCode = !isHeader && language !== undefined && text.length > 0;

				return (
					<Text
						// eslint-disable-next-line react/no-array-index-key
						key={index}
						backgroundColor={style.backgroundColor}
						wrap="truncate-end"
					>
						{gutter.length > 0 ? (
							<Text color={style.gutter}>{gutter}</Text>
						) : null}
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
				);
			})}
		</Box>
	);
}
