import type { ReactNode } from "react";
import { useConsoleLog } from "@/app/hooks/useConsoleLog";
import { useTokens } from "@/theme/useTokens";

/**
 * Renders the temporary M4 console rows.
 *
 * This is a temporary placeholder that M6 replaces with the real console drawer, entry selection,
 * expansion, and copy. It reads only `useConsoleLog`, so it proves that exactly one entry is
 * appended per command result without owning console state. The composition root supplies it to
 * the shell, so no feature imports another feature.
 *
 * @returns The last few console entries or an empty state.
 */
export function ConsoleDrawer(): ReactNode {
  const tokens = useTokens();
  const { entries } = useConsoleLog();
  const recent = entries.slice(-6);

  if (recent.length === 0) {
    return (
      <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1}>
        <text fg={tokens.dim} wrapMode="none">
          No commands yet.
        </text>
      </box>
    );
  }

  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1}>
      {recent.map((entry) => (
        <text
          key={entry.id}
          fg={entry.status === "success" ? tokens.success : tokens.warning}
          wrapMode="none"
        >
          {`${formatEntryTime(entry.at)} ${entry.operationLabel} ${entry.status} ${entry.summary}`}
        </text>
      ))}
    </box>
  );
}

/**
 * Formats an entry timestamp as a short UTC clock value.
 *
 * @param at - Timestamp in milliseconds.
 * @returns `HH:MM:SS`.
 */
function formatEntryTime(at: number): string {
  return new Date(at).toISOString().slice(11, 19);
}
