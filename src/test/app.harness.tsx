import { type ReactNode, useEffect } from "react";
import { useFocusState } from "@/app/hooks/useFocusState";
import { useOverlay } from "@/app/hooks/useOverlay";
import { ConfigProvider } from "@/app/providers/ConfigProvider";
import type { ConfigSnapshot, ConfigSource } from "@/app/providers/ConfigProvider.types";
import { ConsoleProvider } from "@/app/providers/ConsoleProvider";
import { DraftProvider } from "@/app/providers/DraftProvider";
import { FocusProvider } from "@/app/providers/FocusProvider";
import { KeymapProvider } from "@/app/providers/KeymapProvider";
import { OverlayProvider } from "@/app/providers/OverlayProvider";
import { RepositoryProvider } from "@/app/providers/RepositoryProvider";
import { StatusProvider } from "@/app/providers/StatusProvider";
import { ThemeProvider } from "@/app/providers/ThemeProvider";
import type { GitminalConfig } from "@/domain/config/config.types";
import type { GitClient } from "@/domain/git/git.types";
import type { KeymapPlatform } from "@/domain/keymap/keymap.types";
import type { ThemeColorCapability } from "@/domain/theme/theme.types";

export type { ConfigSnapshot, ConfigSource };

/**
 * Mounts the full provider stack a feature needs when it reads repository and command state.
 *
 * Feature tests cannot import app provider components directly, so this test-only harness owns the
 * nesting. It mirrors the production order and never starts a watcher; the caller injects an inert
 * or fake git client so no test spawns a process.
 *
 * @param props - Provider content, git client, working directory, keymap platform, clock, config,
 * config snapshot, config reload source, static theme name, and color capability.
 * @returns The provider stack.
 */
export function AppTestProviders(props: {
  readonly children?: ReactNode;
  readonly gitClient?: GitClient;
  readonly cwd?: string;
  readonly platform?: KeymapPlatform;
  readonly now?: () => number;
  readonly initialFollowMode?: boolean;
  readonly config?: GitminalConfig;
  readonly configSnapshot?: ConfigSnapshot;
  readonly configSource?: ConfigSource;
  readonly themeName?: string;
  readonly capability?: ThemeColorCapability;
}): ReactNode {
  return (
    <ConfigProvider
      initialSnapshot={props.configSnapshot}
      initialConfig={props.config}
      source={props.configSource}
    >
      <ThemeProvider themeName={props.themeName} capability={props.capability ?? "truecolor"}>
        <KeymapProvider platform={props.platform ?? "linux"}>
          <RepositoryProvider
            cwd={props.cwd ?? "/repo"}
            gitClient={props.gitClient}
            enableWatcher={false}
            now={props.now ?? (() => 0)}
          >
            <DraftProvider>
              <FocusProvider>
                <OverlayProvider>
                  <StatusProvider>
                    <ConsoleProvider initialFollowMode={props.initialFollowMode}>
                      {props.children}
                    </ConsoleProvider>
                  </StatusProvider>
                </OverlayProvider>
              </FocusProvider>
            </DraftProvider>
          </RepositoryProvider>
        </KeymapProvider>
      </ThemeProvider>
    </ConfigProvider>
  );
}

/**
 * Renders the content of the single open modal overlay entry.
 *
 * Feature tests cannot import another feature's `OverlayHost`, so this test-only host renders the
 * entry's own render callback without the production focus or dim layers. It exists so an action
 * test can prove an overlay opened and exercise its content while respecting the feature boundary.
 *
 * @returns The open entry content, or null when no modal entry is open.
 */
export function TestOverlayHost(): ReactNode {
  const overlay = useOverlay();
  const focus = useFocusState();
  const entry = overlay.entry;
  const initialFocusId =
    entry !== null && entry.kind === "modal" ? entry.initialFocusId : undefined;

  useEffect(() => {
    if (initialFocusId !== undefined) {
      focus.focusRenderable(initialFocusId);
    }
  }, [focus.focusRenderable, initialFocusId]);

  if (entry === null || entry.kind !== "modal") {
    return null;
  }

  return <>{entry.render({ close: overlay.close })}</>;
}
