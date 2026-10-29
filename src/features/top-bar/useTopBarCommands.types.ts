import type { CommandTarget } from "@/domain/commands/commands.types";

/** Values captured when a force confirmation opens. */
export interface ForceConfirmationCapture {
  /** Command id the confirmation authorises. */
  readonly commandId: string;
  /** Branch name shown and authorised by the confirmation. */
  readonly branch: string;
  /** Configured upstream ref shown by the confirmation, or null. */
  readonly upstreamRef: string | null;
  /** Explicit target captured with the confirmation. */
  readonly target: CommandTarget;
}
