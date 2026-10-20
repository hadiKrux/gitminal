/**
 * Label for the commit action.
 *
 * Unresolved conflicts make the action meaningful even with an empty index:
 * git refuses the commit with the classified `unmerged files` summary, which
 * is something the user asked to see. Only a clean, empty index is
 * "Nothing to commit".
 */
export const commitLabel = (stagedCount: number, conflictCount = 0): string => {
	if (stagedCount === 0) {
		return conflictCount === 0 ? 'Nothing to commit' : 'Commit';
	}

	return `Commit ${stagedCount} file${stagedCount === 1 ? '' : 's'}`;
};
