import type { Commit } from './types.js';

/**
 * One commit's slice of the graph gutter.
 *
 * Lanes are addressed by column: `nodeRow[lane]` is the commit itself and
 * every other entry is the line of a branch passing that row by. `edgeRow` is
 * the line drawn below the node, connecting it to the commit's parents (and
 * closing any branch that merged into it).
 */
export type GraphRow = {
	/** Column of this commit's node. */
	readonly lane: number;
	/** Lane characters on the commit's own line, `*` at the node. */
	readonly nodeRow: string[];
	/** Lane characters on the line below, connecting to the next commits. */
	readonly edgeRow: string[];
};

/**
 * Lay out a git-style commit graph from a newest-first commit list.
 *
 * Only the parent hashes drive the layout, so the same code works on any
 * history: a lane is a column that is waiting for a hash to appear, the first
 * parent keeps the commit's column, and each extra parent opens a new column
 * (the `\` fork). When two columns wait for the same commit they converge
 * there and the right one closes with a `/` on the row above.
 */
export function buildGraph(commits: readonly Commit[]): GraphRow[] {
	/** Expected hash per column, or undefined while the column is free. */
	const lanes = new Array<string | undefined>();
	const rows: GraphRow[] = [];

	for (const commit of commits) {
		let lane = lanes.indexOf(commit.hash);
		if (lane === -1) {
			// A branch tip nobody is waiting for: reuse a freed column or open one.
			lane = lanes.indexOf(undefined);
			if (lane === -1) {
				lane = lanes.length;
				lanes.push(undefined);
			}

			lanes[lane] = commit.hash;
		}

		const before = [...lanes];
		// Columns that were also waiting for this commit converge into it and
		// close from the right.
		const closing = lanes.flatMap((hash, index) =>
			hash === commit.hash && index !== lane ? [index] : [],
		);

		for (let index = 0; index < lanes.length; index++) {
			if (lanes[index] === commit.hash) {
				lanes[index] = undefined;
			}
		}

		const forks: number[] = [];
		const [first, ...rest] = commit.parents;
		if (first !== undefined) {
			lanes[lane] = first;
		}

		for (const parent of rest) {
			// A criss-cross ancestor may already have a lane of its own; fork
			// into that column instead of opening a duplicate.
			const existing = lanes.findIndex(
				(hash, index) => hash === parent && index !== lane,
			);
			if (existing !== -1) {
				forks.push(existing);
				continue;
			}

			let slot = lanes.indexOf(undefined);
			if (slot === -1) {
				slot = lanes.length;
				lanes.push(undefined);
			}

			lanes[slot] = parent;
			forks.push(slot);
		}

		const nodeRow = before.map((hash, index) => {
			if (index === lane) {
				return '*';
			}

			// A converging column already drew its `/` on the row above.
			if (closing.includes(index)) {
				return ' ';
			}

			return hash === undefined ? ' ' : '|';
		});

		const edgeRow = lanes.map((hash, index) => {
			if (forks.includes(index)) {
				return '\\';
			}

			if (index === lane && hash !== undefined) {
				return '|';
			}

			return hash === undefined ? ' ' : '|';
		});

		rows.push({ lane, nodeRow, edgeRow });

		const previous = rows.length > 1 ? rows[rows.length - 2] : undefined;
		if (closing.length > 0 && previous !== undefined) {
			for (const index of closing) {
				if (index < previous.edgeRow.length) {
					previous.edgeRow[index] = '/';
				}
			}
		}
	}

	return rows;
}
