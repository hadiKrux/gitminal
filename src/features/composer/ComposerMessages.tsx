import type { ReactNode } from "react";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";

/**
 * Renders the composer's inline message error and shared state line.
 *
 * The message error only appears after the user attempted a commit with an empty draft, so it is
 * passed as null while the field simply waits for input. The state line explains a missing identity
 * or a running operation. The two never render together, which is why the message field can budget a
 * single reason row.
 *
 * @param props - Message error, whether the state line renders, and its text.
 * @returns The reason rows that are present.
 */
export function ComposerMessages(props: {
  readonly messageError: string | null;
  readonly showStateText: boolean;
  readonly stateText: string | null;
}): ReactNode {
  const tokens = useTokens();

  return (
    <>
      {props.messageError === null ? null : (
        <text fg={tokens.error} wrapMode="none">
          {`${ICONS.error} ${props.messageError}`}
        </text>
      )}
      {props.showStateText ? (
        <text fg={tokens.warning} wrapMode="none">
          {`${ICONS.warning} ${props.stateText ?? ""}`}
        </text>
      ) : null}
    </>
  );
}
