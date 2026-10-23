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
 * The provider sits inside `ConfigProvider` because keybindings depend on the resolved config. It
 * memoizes the resolved action and context projections so consumers can look keys up in constant
 * time without re-resolving on every render.
 *
 * @param props - Platform override and provider content.
 * @returns The keymap context provider.
 */
export function KeymapProvider(props: KeymapProviderProps): ReactNode {
  const { config } = useConfig();
  const detectedPlatform = useMemo(() => detectKeymapPlatform(), []);
  const platform = props.platform ?? detectedPlatform;
  const keymap = useMemo(
    () => resolveKeymap({ config: config.keybindings, platform }),
    [config.keybindings, platform],
  );

  return <KeymapStateContext.Provider value={keymap}>{props.children}</KeymapStateContext.Provider>;
}
