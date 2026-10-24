import type { SyncState } from "@/domain/repository/repository.types";
import type { ThemeToken } from "@/domain/theme/theme.tokens";
import { ICONS } from "@/theme/icons";

/** Theme token used for a sync badge. */
type SyncBadgeTone = Extract<
  ThemeToken,
  "success" | "warning" | "error" | "info" | "muted" | "accent"
>;

/** Marker, label, and color token for one sync state. */
interface SyncBadgeDescriptor {
  /** Text marker from `ICONS`; never the only signal. */
  readonly marker: string;
  /** Visible state text. */
  readonly label: string;
  /** Theme token that colors the badge. */
  readonly tone: SyncBadgeTone;
}

/** Marker, label, and color token for every sync state. */
export const SYNC_BADGES: Readonly<Record<SyncState, SyncBadgeDescriptor>> = Object.freeze({
  "up-to-date": { marker: ICONS.success, label: "up to date", tone: "success" },
  ahead: { marker: ICONS.push, label: "ahead", tone: "accent" },
  behind: { marker: ICONS.pull, label: "behind", tone: "warning" },
  diverged: { marker: ICONS.warning, label: "diverged", tone: "warning" },
  "no-upstream": { marker: ICONS.noUpstream, label: "no upstream", tone: "muted" },
  "upstream-gone": { marker: ICONS.missingUpstream, label: "upstream gone", tone: "error" },
});
