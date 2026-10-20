/**
 * Strip terminal control out of captured git output.
 *
 * Git may still emit colour codes and CR-framed progress even under the exec
 * policy (`color.ui=false` covers user settings, not every code path), and Ink
 * would render those bytes literally: a raw `\r` overwrites the start of the
 * line instead of ending it. The error overlay and the status line's failure
 * summary both run text through this so they show the same visible characters.
 */
/* eslint-disable no-control-regex -- control bytes are exactly what this matches */
const controlPattern =
	/\r|\u001B\[[\d;?]*[ -/]*[@-~]|\u001B][^\u0007\u001B]*(?:\u0007|\u001B\\)/g;
/* eslint-enable no-control-regex */

export const sanitizeOutput = (text: string): string =>
	text.replace(controlPattern, '');

/**
 * Split captured output into physical lines, then sanitize each line.
 *
 * The split must happen first: git updates a progress line in place with a
 * carriage return, so sanitizing first would delete the `\r` and merge
 * `... done.` with the `fatal:` line that follows it. Blank lines are kept
 * because the error overlay renders them as empty rows; classifiers trim and
 * drop them themselves.
 */
export const splitOutputLines = (text: string): readonly string[] =>
	text.split(/\r\n|\r|\n/).map(line => sanitizeOutput(line));

/**
 * Local wall-clock time as `HH:MM:SS`.
 *
 * The console is a live session log, so the time of day is the useful anchor.
 * Local time is deliberate: git failures are read next to whatever the user's
 * terminal shows, not in UTC.
 */
export const formatClockTime = (timestamp: number): string => {
	const date = new Date(timestamp);
	const pad = (value: number): string => String(value).padStart(2, '0');
	return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
		date.getSeconds(),
	)}`;
};

/**
 * Name tables instead of `Intl`, so the output is byte-identical everywhere.
 *
 * The display style is fixed by the list, not by the machine locale, and
 * `Intl` may separate the hour from AM/PM with a narrow no-break space, which
 * would put a character in the UI that a standard keyboard cannot type.
 */
const weekdayNames: readonly string[] = [
	'Sun',
	'Mon',
	'Tue',
	'Wed',
	'Thu',
	'Fri',
	'Sat',
];

const monthNames: readonly string[] = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec',
];

/**
 * An ISO date as the commit list's display style, e.g. `Tue, Sep 8, 1 PM`.
 *
 * Local wall-clock time on purpose, same rationale as `formatClockTime`: the
 * row is read next to the user's own terminal clock, not in the commit's
 * timezone. Minutes are dropped because the list needs the rough moment, not
 * the second. An unparsable value returns '' so the row renders without a
 * date instead of `Invalid Date`.
 */
export const formatDate = (iso: string): string => {
	const date = new Date(iso);

	if (Number.isNaN(date.getTime())) {
		return '';
	}

	const hours = date.getHours();
	const hour = hours % 12 === 0 ? 12 : hours % 12;
	const period = hours < 12 ? 'AM' : 'PM';
	const weekday = weekdayNames[date.getDay()] ?? '';
	const month = monthNames[date.getMonth()] ?? '';

	return `${weekday}, ${month} ${date.getDate()}, ${hour} ${period}`;
};
