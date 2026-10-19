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
const controlPattern = /\r|\u001B\[[\d;?]*[ -/]*[@-~]|\u001B][^\u0007]*\u0007/g;
/* eslint-enable no-control-regex */

export const sanitizeOutput = (text: string): string =>
	text.replace(controlPattern, '');
