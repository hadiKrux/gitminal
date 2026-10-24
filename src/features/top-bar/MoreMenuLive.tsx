import type { ReactNode } from "react";
import { MoreMenu } from "@/features/top-bar/MoreMenu";
import { buildTopBarMoreOptions } from "@/features/top-bar/topBar.controls";
import { useTopBarAvailability } from "@/features/top-bar/useTopBarAvailability";

/**
 * Renders the More menu with availability read on every render.
 *
 * The overlay entry stores a render callback, so a presentational menu that captured options at open
 * time could keep explaining a stale reason. This container subscribes to the repository and status
 * providers and rebuilds the options with the same pure builder the buttons use, so a read that
 * settles while the menu is open updates the visible descriptions.
 *
 * @param props - Receives the explicit command id of the selected option.
 * @returns The live More menu.
 */
export function MoreMenuLive(props: { readonly onSelect: (commandId: string) => void }): ReactNode {
  const { branch, getAvailability } = useTopBarAvailability();
  const options = buildTopBarMoreOptions({ branch, getAvailability });

  return <MoreMenu options={options} onSelect={props.onSelect} />;
}
