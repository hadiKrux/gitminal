import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';
import { truncate } from '../layout.js';
import type { DiffLine, DiffLineKind } from '../data/types.js';

type Props = {
	readonly lines: readonly DiffLine[];
	readonly width: number;
};

/** Columns reserved for each side of the old/new line-number gutter. */
const numberWidth = 3;

type LineStyle = {
	readonly backgroundColor: string;
	readonly foreground: string;
	readonly gutter: string;
};

const styleFor = (kind: DiffLineKind): LineStyle => {
	switch (kind) {
		case 'add': {
			return {
				backgroundColor: theme.addBg,
				foreground: theme.addText,
				gutter: theme.addText,
			};
		}

		case 'del': {
			return {
				backgroundColor: theme.delBg,
				foreground: theme.delText,
				gutter: theme.delText,
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
 * Removed and added rows are painted edge to edge so the change blocks read at
 * a glance; headers carry no line numbers and are rendered as a quiet band.
 */
export default function DiffView({ lines, width }: Props) {
	return (
		<Box flexDirection="column" width={width}>
			{lines.map((line, index) => {
				const style = styleFor(line.kind);
				const isHeader = line.kind === 'header';
				const gutter = isHeader
					? ''
					: `${padNumber(line.oldNumber)} ${padNumber(line.newNumber)} `;
				const text = truncate(line.text, Math.max(0, width - gutter.length));
				const fill = Math.max(0, width - gutter.length - text.length);

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
						<Text color={style.foreground} bold={isHeader}>
							{text}
						</Text>
						{fill > 0 ? <Text>{' '.repeat(fill)}</Text> : null}
					</Text>
				);
			})}
		</Box>
	);
}
