import { PALETTE_RECENT_LIMIT } from "@/features/palette/CommandPalette.constants";
import {
  buildCommandOption,
  buildGroupOption,
  readCommandOptionValue,
} from "@/features/palette/CommandRow";
import type {
  PaletteCategory,
  PaletteCommandEntry,
  PaletteRow,
} from "@/features/palette/CommandRow.types";
import type { BuildPaletteRowsInput, PaletteRows } from "@/features/palette/palette.search.types";

/** Session-only recents, most recent first, deduplicated by command id. */
const recentCommandIds: string[] = [];

/**
 * Filters palette commands by a case-insensitive substring.
 *
 * The needle is matched against the label, the description, every keyword, and every effective
 * shortcut. A grouping row is never produced here; headers are added only after filtering.
 *
 * @param entries - Captured palette commands.
 * @param query - Raw search text.
 * @returns The matching commands in catalogue order.
 */
function filterPaletteEntries(
  entries: readonly PaletteCommandEntry[],
  query: string,
): readonly PaletteCommandEntry[] {
  const needle = query.trim().toLowerCase();

  if (needle.length === 0) {
    return entries;
  }

  return entries.filter((entry) => matchesPaletteQuery(entry, needle));
}

/**
 * Builds the rendered palette rows for one query.
 *
 * An empty query shows the session recents group first and then every command grouped by category.
 * A non-empty query shows only matching commands, still grouped by category. Every group starts with
 * a header row, and each command option carries the category as a name prefix.
 *
 * @param input - Captured commands, query, recents, and text budget.
 * @returns The rows plus the match count that drives the empty state.
 */
export function buildPaletteRows(input: BuildPaletteRowsInput): PaletteRows {
  const needle = input.query.trim().toLowerCase();

  if (needle.length === 0) {
    const recentEntries = readRecentEntries(input.entries, input.recentCommandIds);
    const recentRows = groupByCategory(recentEntries, () => "recent", input.textBudget);
    const catalogueRows = groupByCategory(
      input.entries,
      (entry) => entry.descriptor.category,
      input.textBudget,
    );

    return {
      rows: [...recentRows, ...catalogueRows],
      matchCount: input.entries.length,
    };
  }

  const matching = filterPaletteEntries(input.entries, input.query);

  return {
    rows: groupByCategory(matching, (entry) => entry.descriptor.category, input.textBudget),
    matchCount: matching.length,
  };
}

/**
 * Records one command as the most recent palette command.
 *
 * The list stays session-only, is deduplicated by command id, and is capped at the documented limit.
 *
 * @param commandId - Command that ran.
 */
export function recordRecentCommand(commandId: string): void {
  const existing = recentCommandIds.indexOf(commandId);

  if (existing !== -1) {
    recentCommandIds.splice(existing, 1);
  }

  recentCommandIds.unshift(commandId);
  recentCommandIds.length = Math.min(recentCommandIds.length, PALETTE_RECENT_LIMIT);
}

/**
 * Reads the current session recents.
 *
 * @returns A copy of the recent command ids, most recent first.
 */
export function readRecentCommandIds(): readonly string[] {
  return [...recentCommandIds];
}

/**
 * Clears the session recents.
 *
 * This exists for test isolation only. Production code never calls it.
 */
export function resetRecentCommands(): void {
  recentCommandIds.length = 0;
}

/**
 * Reports whether one command contains the search needle.
 *
 * @param entry - Captured palette command.
 * @param needle - Trimmed, lower-cased search text.
 * @returns True when the label, description, a keyword, or a shortcut contains the needle.
 */
function matchesPaletteQuery(entry: PaletteCommandEntry, needle: string): boolean {
  const candidates = [
    entry.descriptor.label,
    entry.descriptor.description,
    ...entry.descriptor.keywords,
    ...entry.shortcuts,
  ];

  return candidates.some((candidate) => candidate.toLowerCase().includes(needle));
}

/**
 * Resolves the recent command entries in recency order.
 *
 * A command that is no longer palette-invocable is skipped, so a registry change cannot leave a
 * stale recent row behind.
 *
 * @param entries - Captured palette commands.
 * @param ids - Recent command ids, most recent first.
 * @returns The matching entries in recency order.
 */
function readRecentEntries(
  entries: readonly PaletteCommandEntry[],
  ids: readonly string[],
): readonly PaletteCommandEntry[] {
  return ids.flatMap((commandId) => {
    const entry = entries.find((candidate) => candidate.descriptor.id === commandId);

    return entry === undefined ? [] : [entry];
  });
}

/**
 * Groups entries by the category the caller assigns and builds header plus command rows.
 *
 * @param entries - Entries to group, in the order they should render inside each group.
 * @param readCategory - Assigns one entry's group category.
 * @param textBudget - Characters available on one rendered line.
 * @returns Header and command rows in group order.
 */
function groupByCategory(
  entries: readonly PaletteCommandEntry[],
  readCategory: (entry: PaletteCommandEntry) => PaletteCategory,
  textBudget: number,
): readonly PaletteRow[] {
  const order: PaletteCategory[] = [];
  const groups = new Map<PaletteCategory, PaletteCommandEntry[]>();

  for (const entry of entries) {
    const category = readCategory(entry);
    const group = groups.get(category);

    if (group === undefined) {
      groups.set(category, [entry]);
      order.push(category);

      continue;
    }

    group.push(entry);
  }

  return order.flatMap((category) => {
    const group = groups.get(category) ?? [];
    const header: PaletteRow = {
      value: { kind: "group" },
      option: buildGroupOption(category, textBudget),
    };
    const rows = group.map<PaletteRow>((entry) => ({
      value: readCommandOptionValue(entry),
      option: buildCommandOption({ entry, category, textBudget }),
    }));

    return [header, ...rows];
  });
}

/**
 * Reads the first selectable command row.
 *
 * @param rows - Rendered palette rows.
 * @returns The first command row index, or zero for an empty list.
 */
function readFirstSelectableIndex(rows: readonly PaletteRow[]): number {
  const index = rows.findIndex(isCommandRow);

  return index === -1 ? 0 : index;
}

/**
 * Resolves an index to a selectable command row.
 *
 * A header index resolves forward to the next command, then backward, and finally to the first
 * command. An empty list stays at zero.
 *
 * @param rows - Rendered palette rows.
 * @param index - Requested index.
 * @returns A command row index, or zero for an empty list.
 */
export function resolveSelectableIndex(rows: readonly PaletteRow[], index: number): number {
  if (isCommandRow(rows[index])) {
    return index;
  }

  for (let candidate = index + 1; candidate < rows.length; candidate += 1) {
    if (isCommandRow(rows[candidate])) {
      return candidate;
    }
  }

  for (let candidate = Math.min(index, rows.length) - 1; candidate >= 0; candidate -= 1) {
    if (isCommandRow(rows[candidate])) {
      return candidate;
    }
  }

  return readFirstSelectableIndex(rows);
}

/**
 * Moves the selection by a number of command rows, skipping group headers.
 *
 * The selection stops at the last reachable command instead of wrapping, matching the native select
 * behaviour.
 *
 * @param rows - Rendered palette rows.
 * @param current - Currently highlighted index.
 * @param delta - Number of command rows to move; negative moves up.
 * @returns The new command row index.
 */
export function moveSelectableIndex(
  rows: readonly PaletteRow[],
  current: number,
  delta: number,
): number {
  const start = resolveSelectableIndex(rows, current);
  const direction = delta >= 0 ? 1 : -1;
  let result = start;

  for (let step = 0; step < Math.abs(delta); step += 1) {
    let candidate = result + direction;

    while (candidate >= 0 && candidate < rows.length && !isCommandRow(rows[candidate])) {
      candidate += direction;
    }

    if (candidate < 0 || candidate >= rows.length) {
      return result;
    }

    result = candidate;
  }

  return result;
}

/**
 * Reports whether one row is a command rather than a group header.
 *
 * @param row - Candidate row, or undefined when outside the list.
 * @returns True for a command row.
 */
function isCommandRow(
  row: PaletteRow | undefined,
): row is PaletteRow & { readonly value: { readonly kind: "command" } } {
  return row?.value.kind === "command";
}
