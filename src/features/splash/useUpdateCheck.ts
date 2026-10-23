import { useEffect, useRef, useState } from "react";
import { checkForUpdate } from "@/domain/update/update.check";
import type { CheckForUpdate } from "@/domain/update/update.types";
import type { UpdateCheckState } from "@/features/splash/useUpdateCheck.types";

/**
 * Runs one update check when the splash mounts and reports checking or settled state.
 *
 * The check is fire-and-forget: the caller renders immediately, and a result that arrives after
 * unmount is discarded through the `active` flag so no state update happens after dismissal. The
 * checker is captured in a ref so an inline checker does not restart the effect and the check runs
 * at most once per mount. The ref follows the latest `checker` prop, but changing only the checker
 * does not restart the one-shot check because the effect depends only on `packageName` and
 * `currentVersion`. Changing either dependency resets the state to `checking` before the new
 * request starts, so the previous result never renders for the new identity. A rejected checker is
 * treated as `unavailable` while the hook is active, matching the silent failure behavior of the
 * registry check.
 *
 * @param packageName - The package name to query on the npm registry.
 * @param currentVersion - The running version to compare against.
 * @param checker - The update check to run. Defaults to the registry check.
 * @returns `checking` until the one-shot check settles, then the check result.
 */
export function useUpdateCheck(
  packageName: string,
  currentVersion: string,
  checker: CheckForUpdate = checkForUpdate,
): UpdateCheckState {
  const [state, setState] = useState<UpdateCheckState>({ status: "checking" });
  const checkerRef = useRef(checker);

  useEffect(() => {
    checkerRef.current = checker;
  });

  useEffect(() => {
    let isActive = true;

    setState({ status: "checking" });

    void checkerRef.current({ packageName, currentVersion }).then(
      (result) => {
        if (isActive) {
          setState(result);
        }
      },
      () => {
        if (isActive) {
          setState({ status: "unavailable" });
        }
      },
    );

    return () => {
      isActive = false;
    };
  }, [packageName, currentVersion]);

  return state;
}
