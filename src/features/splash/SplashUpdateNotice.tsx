import { TextAttributes } from "@opentui/core";
import type { ReactNode } from "react";
import type { UpdateCheckState } from "@/features/splash/useUpdateCheck.types";

/**
 * Renders the update area of the splash.
 *
 * Shows a dim checking hint while the request is in flight, a two-line notice when a newer version
 * is published, and nothing for an up-to-date or unavailable check. The running version already
 * appears above the notice, so the notice names only the version to upgrade to and keeps each line
 * on a single row at narrow widths.
 *
 * @param props - The package name used for the install command and the update view state.
 * @returns The update area, or `null` when there is nothing to show.
 */
export function SplashUpdateNotice(props: {
  packageName: string;
  update: UpdateCheckState;
}): ReactNode {
  if (props.update.status === "checking") {
    return (
      <text attributes={TextAttributes.DIM} wrapMode="none">
        Checking for updates...
      </text>
    );
  }

  if (props.update.status !== "available") {
    return null;
  }

  return (
    <box flexDirection="column" alignItems="center">
      <text attributes={TextAttributes.BOLD} wrapMode="none">
        Update available: {props.update.latestVersion}
      </text>
      <text wrapMode="none">Run bun add -g {props.packageName}</text>
    </box>
  );
}
