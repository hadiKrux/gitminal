import { useRenderer } from "@opentui/react";
import { type ReactNode, useCallback, useState } from "react";
import { ConfigProvider } from "@/app/providers/ConfigProvider";
import { KeymapProvider } from "@/app/providers/KeymapProvider";
import { ThemeProvider } from "@/app/providers/ThemeProvider";
import { SplashGate } from "@/app/SplashGate";
import { WorkspacePlaceholder } from "@/app/WorkspacePlaceholder";
import type { CheckForUpdate } from "@/domain/update/update.types";

/**
 * Root component that shows the startup splash until any key dismisses it.
 *
 * Owns the one-way `splashDismissed` state and the temporary quit callback that destroys the
 * renderer until the shell's `app.quit` handler replaces it in the app shell milestone. The splash
 * runs before any provider mounts; after dismissal the configuration, theme, and keymap providers
 * wrap the workspace so the first screen can read resolved defaults. It does not subscribe to keys
 * itself: `SplashGate` owns the splash subscription and `WorkspacePlaceholder` owns the
 * post-dismissal subscription, so exactly one keyboard handler is mounted at a time.
 *
 * @param props - Optional update check override for embedding and tests.
 * @returns The splash gate or the provider-backed workspace placeholder.
 */
export function App(props: { checkForUpdate?: CheckForUpdate } = {}): ReactNode {
  const [splashDismissed, setSplashDismissed] = useState(false);
  const renderer = useRenderer();

  const dismissSplash = useCallback(() => {
    setSplashDismissed(true);
  }, []);

  const quitApp = useCallback(() => {
    renderer.destroy();
  }, [renderer]);

  if (splashDismissed) {
    return (
      <ConfigProvider>
        <ThemeProvider>
          <KeymapProvider>
            <WorkspacePlaceholder onQuit={quitApp} />
          </KeymapProvider>
        </ThemeProvider>
      </ConfigProvider>
    );
  }

  return (
    <SplashGate checkForUpdate={props.checkForUpdate} onDismiss={dismissSplash} onQuit={quitApp} />
  );
}
