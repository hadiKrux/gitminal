import type { ReactNode } from "react";
import { COMPOSER_COMMITTING_LABEL } from "@/features/composer/composer.constants";
import type { ComposerControl } from "@/features/composer/composer.types";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import { Button } from "@/ui/Button";
import { Spinner } from "@/ui/Spinner";

/**
 * Renders the composer button row: the options button, the primary Commit button, and the spinner.
 *
 * Both buttons follow the composer's own focused control rather than native focus, and the Commit
 * button carries the blocked reason only when the reason should be visible on the button.
 *
 * @param props - Button ids, labels, focus, disabled state, reason, and press handlers.
 * @returns The button row.
 */
export function ComposerActions(props: {
  readonly moreButtonId: string;
  readonly commitButtonId: string;
  readonly commitLabel: string;
  readonly focusedControl: ComposerControl;
  readonly committing: boolean;
  readonly commitDisabled: boolean;
  readonly commitReason: string | undefined;
  readonly onMore: () => void;
  readonly onCommit: () => void;
}): ReactNode {
  const tokens = useTokens();

  return (
    <box flexDirection="row" flexShrink={0} gap={1} alignItems="center">
      <Button
        id={props.moreButtonId}
        label="More"
        icon={ICONS.ellipsis}
        iconOnly
        focused={props.focusedControl === "more"}
        disabled={props.committing}
        onPress={props.onMore}
      />
      <Button
        id={props.commitButtonId}
        label={props.commitLabel}
        focused={props.focusedControl === "commit"}
        disabled={props.commitDisabled}
        reason={props.commitReason}
        onPress={props.onCommit}
      />
      {props.committing ? (
        <box flexDirection="row" flexShrink={0} gap={1}>
          <Spinner />
          <text fg={tokens.accent} wrapMode="none">
            {COMPOSER_COMMITTING_LABEL}
          </text>
        </box>
      ) : null}
    </box>
  );
}
