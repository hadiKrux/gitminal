import type { ReactNode } from "react";
import { useRepository } from "@/app/hooks/useRepository";
import type { StashRecord } from "@/domain/git/git.types";
import { selectStashRows } from "@/domain/repository/repository.selectors";
import {
  STASH_DETAILS_MISSING_TEXT,
  STASH_DETAILS_READ_ONLY_TEXT,
  STASH_DETAILS_SHORT_OID_LENGTH,
} from "@/features/stashes/StashDetails.constants";
import { formatStashAge } from "@/features/stashes/stash.age";
import { readStashMessage } from "@/features/stashes/stash.prefill";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import { Panel } from "@/ui/Panel";

/**
 * Renders the right-pane summary for the selected stash.
 *
 * The component is composed by `AppShellHost` when `RepositoryProvider.selection.kind` is `stash`.
 * It reads the selection and the snapshot itself, so it takes no props. The summary names the stash
 * message, source branch, relative age, and short object name, and it states that the surface is
 * read-only. The diff itself belongs to the Diff panel; no patch content is duplicated here.
 *
 * A selection whose object name is no longer in the snapshot renders "Stash no longer exists" so a
 * vanished stash is explained instead of silently blanking the pane.
 *
 * @returns The stash summary, or null when the selection is not a stash.
 */
export function StashDetails(): ReactNode {
  const repository = useRepository();
  const tokens = useTokens();
  const selection = repository.selection;

  if (selection.kind !== "stash") {
    return null;
  }

  const stash =
    selectStashRows(repository.snapshot).find(
      (candidate) => candidate.objectName === selection.objectName,
    ) ?? null;

  if (stash === null) {
    return (
      <Panel title="Stash" flexDirection="column" flexShrink={0} padding={1}>
        <text fg={tokens.warning} wrapMode="word">
          {STASH_DETAILS_MISSING_TEXT}
        </text>
      </Panel>
    );
  }

  return (
    <Panel
      title={`Stash ${readStashMessage(stash)}`}
      flexDirection="column"
      flexShrink={0}
      padding={1}
    >
      <text fg={tokens.text} wrapMode="word">
        <span fg={tokens.muted}>Source branch: </span>
        <span>{stash.sourceBranch ?? "not recorded"}</span>
      </text>
      <text fg={tokens.muted} wrapMode="word">
        {`Age: ${formatStashAge(stash.committedAt)} ${ICONS.hintSeparator} Object: ${readShortObjectName(stash)}`}
      </text>
      <text fg={tokens.text} wrapMode="word">
        {STASH_DETAILS_READ_ONLY_TEXT}
      </text>
    </Panel>
  );
}

/**
 * Reads the abbreviated object name shown in the summary.
 *
 * @param stash - Selected stash.
 * @returns The first seven characters of the immutable object name.
 */
function readShortObjectName(stash: StashRecord): string {
  return stash.objectName.slice(0, STASH_DETAILS_SHORT_OID_LENGTH);
}
