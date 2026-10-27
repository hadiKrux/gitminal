import type { ReactNode } from "react";
import type { GitIdentity } from "@/domain/git/git.types";
import { readMissingIdentity } from "@/features/composer/composer.commands";
import { useTokens } from "@/theme/useTokens";
import { TruncatedText } from "@/ui/TruncatedText";

/**
 * Renders the read-only author identity line of the composer.
 *
 * Both configured values are shown as `name <email>`, because the commit author comes from git
 * configuration and the composer never edits it. When one value is unset the line states
 * "Git identity not configured" and names the missing key, so the user knows exactly what to fix in
 * their git configuration outside the app. A text marker is always present; color never carries the
 * missing state alone. The line shares its row with the staged count, so it truncates with the
 * `ICONS.ellipsis` marker to the columns the caller budgets instead of pushing the count off the row.
 *
 * @param props - Configured commit identity and the columns the line may use.
 * @returns The identity line.
 */
export function ComposerIdentity(props: {
  readonly identity: GitIdentity;
  readonly maxWidth: number;
}): ReactNode {
  const tokens = useTokens();
  const missing = readMissingIdentity(props.identity);

  if (missing !== null) {
    return (
      <TruncatedText
        text={`Git identity not configured: set ${missing}`}
        maxWidth={props.maxWidth}
        fg={tokens.warning}
      />
    );
  }

  return (
    <TruncatedText
      text={`${props.identity.name ?? ""} <${props.identity.email ?? ""}>`}
      maxWidth={props.maxWidth}
      fg={tokens.muted}
    />
  );
}
