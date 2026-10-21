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
 * SGR (`CSI < b ; x ; y M|m`) and urxvt (`CSI b ; x ; y M`) reports.
 *
 * The stream-level filter sees the leading escape byte; Ink strips it before
 * its own input handlers run, so both forms are matched here.
 */
// eslint-disable-next-line no-control-regex
const coordinateReport = /\u001B?\[<?\d+(?:;\d+)*[Mm]/g;

/** X10 report: `CSI M` followed by exactly three bytes, including the escape. */
// eslint-disable-next-line no-control-regex
const x10Report = /\u001B\[M[\s\S]{3}/g;

/** Remove every mouse report from a key chunk. */
export const stripMouseReports = (input: string): string =>
	input.replace(coordinateReport, '').replace(x10Report, '');
