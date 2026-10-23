import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import type { ReactNode } from "react";
import { isQuitKey } from "@/app/quit.key";

/**
 * Renders the minimal workspace placeholder shown after splash dismissal.
 *
 * It owns the only keyboard subscription between dismissal and the app shell, and it handles only
 * `Ctrl+C`, which routes to the temporary app quit callback. Every other key is ignored so the
 * placeholder never imitates a shell action. The full shell, providers, and focus model arrive in
 * the app shell milestone.
 *
 * @param props - The temporary quit callback shared with the splash gate.
 * @returns The placeholder workspace surface.
 */
export function WorkspacePlaceholder(props: { onQuit: () => void }): ReactNode {
  useKeyboard((key) => {
    if (isQuitKey(key)) {
      props.onQuit();
    }
  });

  return (
    <box flexDirection="column" flexGrow={1} alignItems="center" justifyContent="center">
      <text id="workspace-placeholder" attributes={TextAttributes.BOLD}>
        Gitminal workspace
      </text>
      <text attributes={TextAttributes.DIM}>
        The full shell is implemented in the next milestone.
      </text>
    </box>
  );
}
