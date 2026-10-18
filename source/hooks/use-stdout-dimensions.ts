import { useEffect, useState } from 'react';
import { useStdout } from 'ink';

export type Dimensions = [
	columns: number | undefined,
	rows: number | undefined,
];

export const useStdoutDimensions = (): Dimensions => {
	const { stdout } = useStdout();
	const [dimensions, setDimensions] = useState<Dimensions>([
		stdout.columns,
		stdout.rows,
	]);

	useEffect(() => {
		const onResize = () => {
			setDimensions([stdout.columns, stdout.rows]);
		};

		onResize();
		stdout.on('resize', onResize);

		return () => {
			stdout.off('resize', onResize);
		};
	}, [stdout]);

	return dimensions;
};
