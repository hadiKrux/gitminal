import React from 'react';
import { Box } from 'ink';
import SyntaxHighlight from 'ink-syntax-highlight';

type Props = {
	readonly code: string;
	readonly language: string;
	readonly width: number;
};

export default function CodePane({ code, language, width }: Props) {
	return (
		<Box width={width} flexDirection="column" paddingX={1}>
			<SyntaxHighlight code={code} language={language} />
		</Box>
	);
}
