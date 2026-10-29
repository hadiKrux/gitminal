import type {
  CommandAvailability,
  CommandDescriptor,
  CommandTarget,
} from "@/domain/commands/commands.types";
import type { ActionCategory } from "@/domain/keymap/keymap.types";

/** Category of one palette row; recents are a synthetic group ahead of the catalogue groups. */
export type PaletteCategory = ActionCategory | "recent";

/**
 * One captured palette command.
 *
 * The entry is built once when the palette opens, so its target and availability are the values the
 * user saw. Activation re-derives both instead of trusting this capture.
 */
export interface PaletteCommandEntry {
  /** Configured remote for a remote-wide fetch entry. */
  readonly fetchRemote?: string;
  /** Registry descriptor the entry came from. */
  readonly descriptor: CommandDescriptor;
  /** Explicit target captured when the palette opened. */
  readonly target: CommandTarget;
  /** Availability captured with the target. */
  readonly availability: CommandAvailability;
  /** Effective bindings formatted for display, empty when the action is unbound. */
  readonly shortcuts: readonly string[];
  /** First effective shortcut, or the documented "Unbound" label. */
  readonly shortcut: string;
}

/** One option passed to the native select. */
export interface PaletteSelectOption {
  /** Option name, carrying the category prefix and the effective shortcut. */
  readonly name: string;
  /** Command description, or the exact disabled reason when unavailable. */
  readonly description: string;
  /** JSON-encoded `PaletteOptionValue`. */
  readonly value: string;
}

/** A decoded option value. A group row is a visual header, never a command. */
export type PaletteOptionValue =
  | {
      readonly kind: "command";
      readonly commandId: string;
      readonly target: CommandTarget;
    }
  | { readonly kind: "group" };

/** One rendered palette row. */
export interface PaletteRow {
  /** Decoded value carried by the select option. */
  readonly value: PaletteOptionValue;
  /** Option rendered by the native select. */
  readonly option: PaletteSelectOption;
}

/** Input accepted by `buildCommandOption`. */
export interface CommandOptionInput {
  /** Captured command entry. */
  readonly entry: PaletteCommandEntry;
  /** Group the row is rendered under. */
  readonly category: PaletteCategory;
  /** Characters available on one rendered line. */
  readonly textBudget: number;
}
