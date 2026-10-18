/**
 * Filtering of mouse reports out of terminal input.
 *
 * The mouse layer turns on xterm mouse reporting, so moving, clicking, or
 * scrolling the mouse writes reports to stdin (for example `\x1b[<35;12;4M`).
 * Ink surfaces each report to every input handler as if it were typed text, so
 * a text field would insert it verbatim. Typed text never looks like a mouse
 * report, so recognising the report formats and dropping them keeps only what
 * the user actually meant to type.
 */

/**
 * SGR (`CSI < b ; x ; y M|m`) and urxvt (`CSI b ; x ; y M`) reports. Ink
 * strips a leading escape byte before handlers see the input, so this matches
 * with or without it.
 */
const coordinateReport = /\[<?\d+(?:;\d+)*[Mm]/g;

/** X10 report: `CSI M` followed by exactly three bytes (four after the escape). */
const isX10Report = (input: string): boolean => {
	if (input.length === 0 || input.length % 5 !== 0) {
		return false;
	}

	for (let index = 0; index < input.length; index += 5) {
		if (input[index] !== '[' || input[index + 1] !== 'M') {
			return false;
		}
	}

	return true;
};

/** Remove every mouse report from a key chunk. */
export const stripMouseReports = (input: string): string => {
	const withoutCoordinates = input.replace(coordinateReport, '');
	return isX10Report(withoutCoordinates) ? '' : withoutCoordinates;
};
