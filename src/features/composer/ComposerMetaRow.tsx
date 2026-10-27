import type { ReactNode } from "react";
import type { GitIdentity } from "@/domain/git/git.types";
import { ComposerIdentity } from "@/features/composer/ComposerIdentity";
import { readComposerIdentityColumns } from "@/features/composer/composer.commands";
import { COMPOSER_META_GAP } from "@/features/composer/composer.constants";
import { useTokens } from "@/theme/useTokens";

/**
 * Renders the composer meta row: identity on the left, staged count on the right.
 *
 * The row sits directly below the message field. The staged count and the amend indicator keep the
 * right edge, so the identity line is budgeted the remaining columns and truncates with the
 * `ICONS.ellipsis` marker instead of pushing the count off the row.
 *
 * @param props - Identity, staged count, amend short hash, and the measured body columns.
 * @returns The meta row.
 */
export function ComposerMetaRow(props: {
  readonly identity: GitIdentity;
  readonly stagedCount: number;
  readonly amendShortHash: string | null;
  readonly columns: number;
}): ReactNode {
  const tokens = useTokens();
  const stagedLabel = `${props.stagedCount} staged`;
  const amendLabel = props.amendShortHash === null ? null : `Amending ${props.amendShortHash}`;
  const identityColumns = readComposerIdentityColumns({
    rowColumns: props.columns,
    stagedLabel,
    amendLabel,
  });

  return (
    <box
      flexDirection="row"
      flexShrink={0}
      gap={COMPOSER_META_GAP}
      alignItems="center"
      justifyContent="space-between"
    >
      <ComposerIdentity identity={props.identity} maxWidth={identityColumns} />
      <box flexDirection="row" flexShrink={0} gap={COMPOSER_META_GAP}>
        <text fg={tokens.muted} wrapMode="none">
          {stagedLabel}
        </text>
        {amendLabel === null ? null : (
          <text fg={tokens.accent} wrapMode="none">
            {amendLabel}
          </text>
        )}
      </box>
    </box>
  );
}
