import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import type { ReactNode } from "react";
import { useKeymap } from "@/app/hooks/useKeymap";
import { useTheme } from "@/app/hooks/useTheme";
import { isQuitKey } from "@/app/quit.key";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";

/**
 * Renders the minimal workspace placeholder shown after splash dismissal.
 *
 * It mounts inside the config, theme, and keymap providers. It owns the only keyboard subscription
 * between dismissal and the app shell, and it handles only `Ctrl+C`, which routes to the temporary
 * app quit callback; the resolved keymap is not dispatched until `useHotkeys` lands. Every other
 * key is ignored so the placeholder never imitates a shell action. The status line reads the
 * resolved theme label and the resolved action count, which proves the M2 core resolved without a
 * configuration file, and it is replaced by the real shell.
 *
 * @param props - The temporary quit callback shared with the splash gate.
 * @returns The placeholder workspace surface.
 */
export function WorkspacePlaceholder(props: { onQuit: () => void }): ReactNode {
  const theme = useTheme();
  const keymap = useKeymap();
  const tokens = useTokens();

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
      <text id="workspace-core-status" fg={tokens.muted} attributes={TextAttributes.DIM}>
        Theme: {theme.label} {ICONS.hintSeparator} {keymap.bindings.size} actions
      </text>
    </box>
  );
}
