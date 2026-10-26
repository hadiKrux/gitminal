import { describeCommandReason } from "@/domain/commands/commands.reasons";
import type { CommandTarget } from "@/domain/commands/commands.types";
import {
  PALETTE_CATEGORY_LABELS,
  PALETTE_GROUP_HEADER_PREFIX,
  PALETTE_GROUP_HEADER_SUFFIX,
} from "@/features/palette/CommandRow.constants";
import type {
  CommandOptionInput,
  PaletteCategory,
  PaletteCommandEntry,
  PaletteOptionValue,
  PaletteSelectOption,
} from "@/features/palette/CommandRow.types";
import { isPlainObject } from "@/lib/object";
import { truncateText } from "@/lib/text";
import { ICONS } from "@/theme/icons";

/** Every command target kind, used to validate a decoded option value. */
const TARGET_KINDS: ReadonlySet<string> = new Set<CommandTarget["kind"]>([
  "none",
  "branch",
  "remoteBranch",
  "tag",
  "stash",
  "worktree",
  "commit",
  "pending",
  "diffFile",
  "form",
]);

/**
 * Projects one captured command into a native select option.
 *
 * The option name carries the category prefix and the effective shortcut, so the category stays
 * visible even though a native select cannot render a non-selectable header inside its list. An
 * unavailable command keeps its row and uses the exact shared reason text as its description, so a
 * disabled entry explains itself instead of disappearing. Both strings are truncated with the
 * measured text budget.
 *
 * @param input - Captured command, its group, and the text budget.
 * @returns The projected select option.
 */
export function buildCommandOption(input: CommandOptionInput): PaletteSelectOption {
  const { descriptor } = input.entry;
  const categoryLabel = readPaletteCategoryLabel(input.category);
  const shortcut = ` (${input.entry.shortcut})`;
  const name = truncateText(
    `${categoryLabel}: ${descriptor.label}${shortcut}`,
    input.textBudget,
    ICONS.ellipsis,
  );
  const description = truncateText(readCommandDescription(input), input.textBudget, ICONS.ellipsis);

  return {
    name,
    description,
    value: encodePaletteValue(readCommandOptionValue(input.entry)),
  };
}

/**
 * Builds the decoded option value of one captured command.
 *
 * @param entry - Captured command entry.
 * @returns The explicit command and target payload.
 */
export function readCommandOptionValue(entry: PaletteCommandEntry): PaletteOptionValue {
  return { kind: "command", commandId: entry.descriptor.id, target: entry.target };
}

/**
 * Builds one category header option.
 *
 * The header is a select row because the native select has no non-selectable item. Its decoded value
 * is a group marker, so activation ignores it and it never dispatches a command.
 *
 * @param category - Group the header introduces.
 * @param textBudget - Characters available on one rendered line.
 * @returns The projected header option.
 */
export function buildGroupOption(
  category: PaletteCategory,
  textBudget: number,
): PaletteSelectOption {
  const label = readPaletteCategoryLabel(category);

  return {
    name: truncateText(
      `${PALETTE_GROUP_HEADER_PREFIX}${label}${PALETTE_GROUP_HEADER_SUFFIX}`,
      textBudget,
      ICONS.ellipsis,
    ),
    description: "",
    value: encodePaletteValue({ kind: "group" }),
  };
}

/**
 * Reads the display label of one palette category.
 *
 * @param category - Command or synthetic palette category.
 * @returns The category label.
 */
function readPaletteCategoryLabel(category: PaletteCategory): string {
  return PALETTE_CATEGORY_LABELS[category];
}

/**
 * Reads the description shown under one command.
 *
 * An unavailable command shows the exact shared reason text. An available command shows its
 * registry description.
 *
 * @param input - Captured command.
 * @returns The description text before truncation.
 */
function readCommandDescription(input: CommandOptionInput): string {
  if (input.entry.availability.available) {
    return input.entry.descriptor.description;
  }

  return describeCommandReason(input.entry.availability.reason ?? "command-not-implemented");
}

/**
 * Encodes an option value for the native select.
 *
 * `SelectOption.value` is a string, so the explicit `{ commandId, target }` payload is serialized
 * here and decoded at activation. Keeping one codec in this module means the palette never parses
 * or builds the payload inline.
 *
 * @param value - Decoded option value.
 * @returns The serialized value.
 */
export function encodePaletteValue(value: PaletteOptionValue): string {
  return JSON.stringify(value);
}

/**
 * Decodes one native select value.
 *
 * @param value - Serialized option value.
 * @returns The decoded payload, or null when the value is not a palette payload.
 */
export function decodePaletteValue(value: string): PaletteOptionValue | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }

  if (!isPlainObject(parsed) || typeof parsed.kind !== "string") {
    return null;
  }

  if (parsed.kind === "group") {
    return { kind: "group" };
  }

  if (parsed.kind !== "command" || typeof parsed.commandId !== "string") {
    return null;
  }

  const target = parsed.target;

  if (!isCommandTargetValue(target)) {
    return null;
  }

  return { kind: "command", commandId: parsed.commandId, target };
}

/**
 * Reports whether a decoded value carries a known command target kind.
 *
 * The palette only reads `kind` and the target fields it captured, so validating the discriminator
 * is enough to reject a corrupted value while keeping the codec small.
 *
 * @param value - Candidate target.
 * @returns True when the value is a command target object.
 */
function isCommandTargetValue(value: unknown): value is CommandTarget {
  return isPlainObject(value) && typeof value.kind === "string" && TARGET_KINDS.has(value.kind);
}
