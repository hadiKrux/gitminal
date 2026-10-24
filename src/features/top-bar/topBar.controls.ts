import { describeCommandReason } from "@/domain/commands/commands.reasons";
import { getCommandDescriptor } from "@/domain/commands/commands.registry";
import type { CommandTarget } from "@/domain/commands/commands.types";
import type {
  TopBarAvailabilityReader,
  TopBarControl,
  TopBarMoreOption,
} from "@/features/top-bar/useTopBar.types";
import { ICONS } from "@/theme/icons";

/** One More menu row before availability is applied. */
interface MoreOptionRow {
  /** Explicit command id. */
  readonly commandId: string;
  /** Visible menu label. */
  readonly label: string;
  /** Normal description shown while the option is available. */
  readonly description: string;
}

/** More menu rows in display order. */
const MORE_OPTION_ROWS: readonly MoreOptionRow[] = Object.freeze([
  {
    commandId: "remote.fetch",
    label: "Fetch",
    description: "Fetch the upstream refs of local branches",
  },
  {
    commandId: "remote.fetchPrune",
    label: "Fetch --prune",
    description: "Fetch and delete remote tracking refs confirmed gone",
  },
  {
    commandId: "remote.pushForceSafe",
    label: "Push force (safe)",
    description: "Push with --force-with-lease",
  },
  {
    commandId: "remote.pushForceOverwrite",
    label: "Push force (overwrite)",
    description: "Push with --force and overwrite the remote branch",
  },
  {
    commandId: "remote.pushNoVerify",
    label: "Push --no-verify",
    description: "Push with --no-verify",
  },
]);

/**
 * Resolves the explicit command target for a remote command.
 *
 * @param commandId - Command id.
 * @param branch - Current branch name.
 * @returns The branch target for branch commands, or the none target.
 */
export function resolveCommandTarget(commandId: string, branch: string): CommandTarget {
  return getCommandDescriptor(commandId)?.targetKind === "branch"
    ? { kind: "branch", name: branch }
    : { kind: "none" };
}

/**
 * Builds the control list in `nav.left`/`nav.right` order.
 *
 * The idle info control is a stop only while no operation and no transient message is active,
 * matching the product spec: while progress or a message is shown, Left and Right move between Pull,
 * Push, and More. More is always available so the menu can explain every disabled option.
 *
 * @param input - Branch, running and message flags, and the availability reader.
 * @returns Controls with their availability and display reasons.
 */
export function buildTopBarControls(input: {
  readonly branch: string;
  readonly running: boolean;
  readonly hasActiveStatus: boolean;
  readonly getAvailability: TopBarAvailabilityReader;
}): readonly TopBarControl[] {
  const controls: TopBarControl[] = [];

  if (!input.running && !input.hasActiveStatus) {
    controls.push({ kind: "info", label: "Branch", available: true, reason: null });
  }

  controls.push(
    buildCommandControl(input, {
      kind: "pull",
      label: "Pull",
      icon: ICONS.pull,
      commandId: "remote.pull",
    }),
    buildCommandControl(input, {
      kind: "push",
      label: "Push",
      icon: ICONS.push,
      commandId: "remote.push",
    }),
    { kind: "more", label: "More", icon: ICONS.ellipsis, available: true, reason: null },
  );

  return controls;
}

/**
 * Builds one command control from fresh availability.
 *
 * @param input - Branch and availability reader.
 * @param control - Kind, label, icon, and command id.
 * @returns The control with its availability and reason.
 */
function buildCommandControl(
  input: {
    readonly branch: string;
    readonly getAvailability: TopBarAvailabilityReader;
  },
  control: {
    readonly kind: "pull" | "push";
    readonly label: string;
    readonly icon: string;
    readonly commandId: string;
  },
): TopBarControl {
  const availability = readAvailability(
    input.getAvailability,
    control.commandId,
    resolveCommandTarget(control.commandId, input.branch),
  );

  return {
    kind: control.kind,
    label: control.label,
    icon: control.icon,
    available: availability.available,
    reason: availability.reason,
  };
}

/**
 * Builds the More menu options with their availability reasons.
 *
 * @param input - Branch and availability reader.
 * @returns Options in display order.
 */
export function buildTopBarMoreOptions(input: {
  readonly branch: string;
  readonly getAvailability: TopBarAvailabilityReader;
}): readonly TopBarMoreOption[] {
  return MORE_OPTION_ROWS.map((row) => {
    const availability = readAvailability(
      input.getAvailability,
      row.commandId,
      resolveCommandTarget(row.commandId, input.branch),
    );

    return {
      commandId: row.commandId,
      label: row.label,
      description: availability.reason ?? row.description,
      available: availability.available,
      reason: availability.reason,
    };
  });
}

/**
 * Reads availability and converts a machine reason into display text.
 *
 * @param getAvailability - Reader bound to the current repository state.
 * @param commandId - Command id.
 * @param target - Explicit command target.
 * @returns Availability with display text for the blocked reason.
 */
function readAvailability(
  getAvailability: TopBarAvailabilityReader,
  commandId: string,
  target: CommandTarget,
): { readonly available: boolean; readonly reason: string | null } {
  const availability = getAvailability(commandId, target);

  return {
    available: availability.available,
    reason:
      availability.available || availability.reason === undefined
        ? null
        : describeCommandReason(availability.reason),
  };
}
