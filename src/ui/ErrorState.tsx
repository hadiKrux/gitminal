import type { ReactNode } from "react";
import { truncateText } from "@/lib/text";
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
 * A caller that renders the error in a fixed footer passes `compactWidth`. The compact form truncates
 * the message and details to one line each at that measured width, keeps the Retry on its own row,
 * and drops the inter-row gap, so a wrapped git message cannot push the action or the rows above it
 * outside the panel.
 *
 * @param props - Error message, optional details, retry callback, optional id, focus state, and
 * compact width.
 * @returns The composed error state.
 */
export function ErrorState(props: {
  readonly message: string;
  readonly details?: string;
  readonly onRetry: () => void;
  readonly retryId?: string;
  readonly retryFocused?: boolean;
  readonly compactWidth?: number;
}): ReactNode {
  const tokens = useTokens();

  if (props.compactWidth !== undefined) {
    return (
      <CompactErrorState
        message={props.message}
        details={props.details}
        width={props.compactWidth}
        onRetry={props.onRetry}
        retryId={props.retryId}
        retryFocused={props.retryFocused === true}
      />
    );
  }

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

/**
 * Renders the one-line-per-row error form used by fixed footers.
 *
 * @param props - Error text, optional details, measured width, Retry action, and Retry state.
 * @returns The compact error state.
 */
function CompactErrorState(props: {
  readonly message: string;
  readonly details: string | undefined;
  readonly width: number;
  readonly onRetry: () => void;
  readonly retryId: string | undefined;
  readonly retryFocused: boolean;
}): ReactNode {
  const tokens = useTokens();
  const budget = Math.max(0, Math.floor(props.width) - 1);

  return (
    <box flexDirection="column" flexShrink={0} paddingLeft={1}>
      <text fg={tokens.error} wrapMode="none">
        {truncateText(readCompactLine(`${ICONS.error} ${props.message}`), budget, ICONS.ellipsis)}
      </text>
      {props.details === undefined ? null : (
        <text fg={tokens.muted} wrapMode="none">
          {truncateText(readCompactLine(props.details), budget, ICONS.ellipsis)}
        </text>
      )}
      <box flexDirection="row" flexShrink={0}>
        <Button
          id={props.retryId}
          label="Retry"
          focused={props.retryFocused}
          onPress={props.onRetry}
        />
      </box>
    </box>
  );
}

/**
 * Collapses whitespace runs so a multi-line failure still renders on one footer line.
 *
 * @param text - Error text that may contain newlines or padded whitespace.
 * @returns The single-line text.
 */
function readCompactLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
