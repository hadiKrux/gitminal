/** Shared label for the commit action, used by the header and group rows. */
export const commitLabel = (stagedCount: number): string =>
	stagedCount === 0
		? 'Nothing to commit'
		: `Commit ${stagedCount} file${stagedCount === 1 ? '' : 's'}`;
