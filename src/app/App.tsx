import { useRenderer } from "@opentui/react";
import { type ReactNode, useCallback, useState } from "react";
import { SplashGate } from "@/app/SplashGate";
import { WorkspacePlaceholder } from "@/app/WorkspacePlaceholder";
import type { CheckForUpdate } from "@/domain/update/update.types";

/**
 * Root component that shows the startup splash until any key dismisses it.
 *
 * Owns the one-way `splashDismissed` state and the temporary quit callback that destroys the
 * renderer until the shell's `app.quit` handler replaces it in the app shell milestone. It does not
 * subscribe to keys itself: `SplashGate` owns the splash subscription and `WorkspacePlaceholder`
 * owns the post-dismissal subscription, so exactly one keyboard handler is mounted at a time.
 *
 * @param props - Optional update check override for embedding and tests.
 * @returns The splash gate or the workspace placeholder.
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
    return <WorkspacePlaceholder onQuit={quitApp} />;
  }

  return (
    <SplashGate checkForUpdate={props.checkForUpdate} onDismiss={dismissSplash} onQuit={quitApp} />
  );
}
