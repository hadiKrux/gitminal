import React, { useCallback, useRef } from 'react';
import { Box, Text } from 'ink';
import { ThemeProvider, TextInput, defaultTheme, extendTheme } from '@inkjs/ui';
import { theme } from '../theme.js';

type Props = {
	/** Visible width of the field; the row is filled to this width. */
	readonly width: number;
	readonly placeholder: string;
	readonly onChange?: (value: string) => void;
	readonly onSubmit: (value: string) => void;
};

/**
 * The input's own text style, extended from the library default so the field
 * blends into the panel instead of picking up the terminal's default colours.
 */
const inputTheme = extendTheme(defaultTheme, {
	components: {
		TextInput: {
			styles: {
				value: () => ({
					backgroundColor: theme.bgPanel,
					color: theme.text,
				}),
			},
		},
	},
});

/**
 * A single-line text field for overlays.
 *
 * Ink UI's `TextInput` owns the value and cursor, so this wrapper only paints
 * the field: a full-width background layer keeps the panel solid beneath the
 * text, and the row is capped at one line so a value longer than the field is
 * clipped instead of wrapping the frame.
 *
 * `TextInput` reports its value from an effect that depends on `onChange`.
 * Passing the caller's callback straight through makes that effect rerun on
 * every parent render (the callback identity changes) and report the same
 * value again, which resets state the caller changed for another reason. A
 * stable callback that forwards to the latest prop keeps one edit reported
 * once.
 */
export default function SingleLineInput({
	width,
	placeholder,
	onChange,
	onSubmit,
}: Props) {
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;
	const reportChange = useCallback((value: string) => {
		onChangeRef.current?.(value);
	}, []);

	return (
		<Box width={width} height={1} flexDirection="row" overflow="hidden">
			{/*
			 * The background is painted first as its own full-width layer. The
			 * input is uncontrolled, so the wrapper cannot know where its text
			 * ends; painting the whole field lets the input overwrite exactly the
			 * cells it uses while the rest stays panel-coloured.
			 */}
			<Box position="absolute" width={width} height={1}>
				<Text backgroundColor={theme.bgPanel}>{' '.repeat(width)}</Text>
			</Box>
			<ThemeProvider theme={inputTheme}>
				<TextInput
					placeholder={placeholder}
					onChange={reportChange}
					onSubmit={onSubmit}
				/>
			</ThemeProvider>
		</Box>
	);
}
