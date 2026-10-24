import type { ReactNode } from "react";
import type { SyncState } from "@/domain/repository/repository.types";
import type { ThemeTokens } from "@/domain/theme/theme.types";
import { SYNC_BADGES } from "@/features/top-bar/SyncStateBadge.constants";
import { StatusBadge } from "@/ui/StatusBadge";

/**
 * Renders the sync relationship between the current branch and its upstream.
 *
 * The component is a projection: the sync state is derived by `repository.selectors.ts`, and the
 * caller supplies the theme tokens it should color from. Every state renders a text marker and a
 * word, so the badge is never color-only.
 *
 * @param props - Sync state and the active theme tokens.
 * @returns The sync badge.
 */
export function SyncStateBadge(props: {
  readonly sync: SyncState;
  readonly tokens: ThemeTokens;
}): ReactNode {
  const badge = SYNC_BADGES[props.sync];

  return <StatusBadge marker={badge.marker} label={badge.label} fg={props.tokens[badge.tone]} />;
}
