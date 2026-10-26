import type { ReactNode } from "react";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import { Button } from "@/ui/Button";

/**
 * Renders an inline error with a Retry action.
 *
 * The error marker comes from `ICONS.error` and is always paired with the message, so the failure
 * never depends on color. Optional details carry the git error text under the message. Retry is a
 * `Button`, so the owning feature decides whether it is the focused control and may pass a stable
 * id for focus restoration.
 *
 * @param props - Error message, optional details, retry callback, and optional id and focus state.
 * @returns The composed error state.
 */
export function ErrorState(props: {
  readonly message: string;
  readonly details?: string;
  readonly onRetry: () => void;
  readonly retryId?: string;
  readonly retryFocused?: boolean;
}): ReactNode {
  const tokens = useTokens();

  return (
    <box flexDirection="column" flexShrink={0} paddingLeft={1} gap={1}>
      <text fg={tokens.error} wrapMode="word">
        {`${ICONS.error} ${props.message}`}
      </text>
      {props.details === undefined ? null : (
        <text fg={tokens.muted} wrapMode="word">
          {props.details}
        </text>
      )}
      <box flexDirection="row" flexShrink={0}>
        <Button
          id={props.retryId}
          label="Retry"
          focused={props.retryFocused === true}
          onPress={props.onRetry}
        />
      </box>
    </box>
  );
}
