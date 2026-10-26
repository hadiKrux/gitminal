import { useRenderer } from "@opentui/react";
import { type ReactNode, useCallback, useState } from "react";
import { AppShellHost } from "@/app/AppShellHost";
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
import { SplashGate } from "@/app/SplashGate";
import type { GitClient } from "@/domain/git/git.types";
import type { CheckForUpdate } from "@/domain/update/update.types";

/**
 * Root component that shows the startup splash until any key dismisses it.
 *
 * Owns the one-way `splashDismissed` state and the splash-only quit callback that destroys the
 * renderer. The splash runs before any provider mounts; after dismissal the configuration, theme,
 * keymap, repository, draft, focus, status, and console providers wrap the shell, which owns
 * `app.quit` and the centralized keyboard dispatcher from then on. `App` does not subscribe to keys
 * itself: `SplashGate` owns the splash subscription and `useHotkeys` owns every key after the shell
 * mounts, so exactly one keyboard handler is mounted at a time.
 *
 * Configuration is loaded by the bootstrap before the first render, so the shell never shows a
 * loading state: the resolved snapshot arrives as a prop together with the source a reload uses.
 * Both are optional, so a test can mount the app against the built-in configuration without
 * touching the filesystem.
 *
 * @param props - Git client, cwd, watcher, update check, configuration source and snapshot, and an
 * optional test probe.
 * @returns The splash gate or the provider-backed shell.
 */
export function App(
  props: {
    checkForUpdate?: CheckForUpdate;
    gitClient?: GitClient;
    repositoryCwd?: string;
    enableWatcher?: boolean;
    configSource?: ConfigSource;
    configSnapshot?: ConfigSnapshot;
    probe?: ReactNode;
  } = {},
): ReactNode {
  const [splashDismissed, setSplashDismissed] = useState(false);
  const renderer = useRenderer();

  const dismissSplash = useCallback(() => {
    setSplashDismissed(true);
  }, []);

  const quitSplash = useCallback(() => {
    renderer.destroy();
  }, [renderer]);

  if (splashDismissed) {
    return (
      <ConfigProvider source={props.configSource} initialSnapshot={props.configSnapshot}>
        <ThemeProvider>
          <KeymapProvider>
            <RepositoryProvider
              cwd={props.repositoryCwd}
              gitClient={props.gitClient}
              enableWatcher={props.enableWatcher}
            >
              <DraftProvider>
                <FocusProvider>
                  <OverlayProvider>
                    <StatusProvider>
                      <ConsoleProvider>
                        <AppShellHost />
                        {props.probe}
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

  return (
    <SplashGate
      checkForUpdate={props.checkForUpdate}
      onDismiss={dismissSplash}
      onQuit={quitSplash}
    />
  );
}
