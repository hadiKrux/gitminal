import type { ReactNode } from "react";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";

/** How many conflicted paths the banner names before summarizing the rest. */
const CONFLICT_BANNER_MAX_PATHS = 3;

/** Operation wording keyed by the in-progress marker. */
const OPERATION_LABELS = Object.freeze({
  merge: "Merge in progress",
  rebase: "Rebase in progress",
  "cherry-pick": "Cherry-pick in progress",
});

/**
 * Renders the conflict banner and the merge, rebase, or cherry-pick banner.
 *
 * The banner names the operation or the conflicted files and always states the remedy: resolve each
 * file externally, then stage it. It renders nothing when no conflict or operation marker is active,
 * so the panel body starts directly with the sections in the normal case. Every marker comes from
 * `ICONS` and is paired with words, so the state never depends on color alone.
 *
 * @param props - Conflicted paths and the in-progress operation, when any.
 * @returns The banner, or null when the repository needs no notice.
 */
export function ConflictBanner(props: {
  readonly conflictedFiles: readonly string[];
  readonly operation: "merge" | "rebase" | "cherry-pick" | null;
}): ReactNode {
  const tokens = useTokens();

  if (props.operation === null && props.conflictedFiles.length === 0) {
    return null;
  }

  return (
    <box flexDirection="column" flexShrink={0} paddingLeft={1}>
      {props.operation === null ? null : (
        <text fg={tokens.warning} wrapMode="word">
          {`${ICONS.warning} ${OPERATION_LABELS[props.operation]} - resolve each conflicted file, then stage it.`}
        </text>
      )}
      {props.conflictedFiles.length === 0 ? null : (
        <text fg={tokens.warning} wrapMode="word">
          {`${ICONS.warning} ${readConflictSummary(props.conflictedFiles)}`}
        </text>
      )}
    </box>
  );
}

/**
 * Builds the conflicted-file summary.
 *
 * @param paths - Conflicted paths.
 * @returns The count, the named paths, and the overflow summary.
 */
function readConflictSummary(paths: readonly string[]): string {
  const named = paths.slice(0, CONFLICT_BANNER_MAX_PATHS);
  const remaining = paths.length - named.length;
  const overflow = remaining > 0 ? ` (+${remaining} more)` : "";
  const noun = paths.length === 1 ? "file" : "files";

  return `Conflicts in ${paths.length} ${noun}: ${named.join(", ")}${overflow}. Resolve each file externally, then stage it.`;
}
