import { createContext, type ReactNode, useMemo } from "react";
import { useConfig } from "@/app/hooks/useConfig";
import type { KeymapProviderProps } from "@/app/providers/KeymapProvider.types";
import { detectKeymapPlatform } from "@/domain/keymap/keymap.parse";
import { resolveKeymap } from "@/domain/keymap/keymap.resolve";
import type { ResolvedKeymap } from "@/domain/keymap/keymap.types";

/** Context carrying the resolved keymap. */
export const KeymapStateContext = createContext<ResolvedKeymap | null>(null);

/**
 * Resolves the effective keymap from configuration and built-in defaults.
 *
 * The provider sits inside `ConfigProvider` because keybindings depend on the resolved config. Both
 * override layers flow through the same resolution: `config.json` keybindings first, then the
 * validated `keybindings.json` map, which wins for the same action. Parsing, `null` resets, `[]`
 * unbinds, and conflict settlement all live in `@/domain/keymap`, so the provider only memoizes the
 * resolved projections. Consumers look keys up in constant time and re-resolve only when a layer
 * changes, which is also what makes an `app.reloadConfig` refresh the effective bindings.
 *
 * @param props - Platform override and provider content.
 * @returns The keymap context provider.
 */
export function KeymapProvider(props: KeymapProviderProps): ReactNode {
  const { config, keybindingsFile } = useConfig();
  const detectedPlatform = useMemo(() => detectKeymapPlatform(), []);
  const platform = props.platform ?? detectedPlatform;
  const keybindings = config.keybindings;
  const keymap = useMemo(
    () => resolveKeymap({ config: keybindings, keybindings: keybindingsFile, platform }),
    [keybindings, keybindingsFile, platform],
  );

  return <KeymapStateContext.Provider value={keymap}>{props.children}</KeymapStateContext.Provider>;
}
