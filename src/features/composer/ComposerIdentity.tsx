import type { ReactNode } from "react";
import type { GitIdentity } from "@/domain/git/git.types";
import { readMissingIdentity } from "@/features/composer/composer.commands";
import { useTokens } from "@/theme/useTokens";

/**
 * Renders the read-only author identity line of the composer.
 *
 * Both configured values are shown as `name <email>`, because the commit author comes from git
 * configuration and the composer never edits it. When one value is unset the line states
 * "Git identity not configured" and names the missing key, so the user knows exactly what to fix in
 * their git configuration outside the app. A text marker is always present; color never carries the
 * missing state alone.
 *
 * @param props - Configured commit identity.
 * @returns The identity line.
 */
export function ComposerIdentity(props: { readonly identity: GitIdentity }): ReactNode {
  const tokens = useTokens();
  const missing = readMissingIdentity(props.identity);

  if (missing !== null) {
    return (
      <text fg={tokens.warning} wrapMode="none">
        {`Git identity not configured: set ${missing}`}
      </text>
    );
  }

  return (
    <text fg={tokens.muted} wrapMode="none">
      {`${props.identity.name ?? ""} <${props.identity.email ?? ""}>`}
    </text>
  );
}
