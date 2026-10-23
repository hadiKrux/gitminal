import { useKeyboard } from "@opentui/react";
import type { ReactNode } from "react";
import { APP_PACKAGE_NAME, APP_VERSION } from "@/app/app.constants";
import { isQuitKey } from "@/app/quit.key";
import type { CheckForUpdate } from "@/domain/update/update.types";
import { SplashScreen } from "@/features/splash/SplashScreen";
import { useUpdateCheck } from "@/features/splash/useUpdateCheck";

/**
 * Hosts the splash screen, its one-shot update check, and the single splash keyboard subscription.
 *
 * The gate is mounted only while the splash is visible, so its `useKeyboard` subscription is the
 * only one removed when the workspace placeholder mounts. `Ctrl+C` is routed to `onQuit` without
 * dismissing, and every other key dismisses through `onDismiss`, so quitting never also dismisses
 * the splash.
 *
 * @param props - The dismissal and quit callbacks plus an optional update check override.
 * @returns The splash screen.
 */
export function SplashGate(props: {
  checkForUpdate?: CheckForUpdate;
  onDismiss: () => void;
  onQuit: () => void;
}): ReactNode {
  const update = useUpdateCheck(APP_PACKAGE_NAME, APP_VERSION, props.checkForUpdate);

  useKeyboard((key) => {
    if (isQuitKey(key)) {
      props.onQuit();
      return;
    }

    props.onDismiss();
  });

  return <SplashScreen packageName={APP_PACKAGE_NAME} version={APP_VERSION} update={update} />;
}
