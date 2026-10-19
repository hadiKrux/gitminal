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
 * Local wall-clock time as `HH:MM:SS`.
 *
 * The console is a live session log, so the time of day is the useful anchor;
 * a full date joins this module in ticket 07. Local time is deliberate: git
 * failures are read next to whatever the user's terminal shows, not in UTC.
 */
export const formatClockTime = (timestamp: number): string => {
	const date = new Date(timestamp);
	const pad = (value: number): string => String(value).padStart(2, '0');
	return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
		date.getSeconds(),
	)}`;
};
