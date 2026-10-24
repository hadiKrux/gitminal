import { type ReactNode, useCallback, useState } from "react";
import { useAction } from "@/app/hooks/useAction";
import {
  MORE_MENU_HEIGHT,
  MORE_MENU_SELECT_ID,
  MORE_MENU_TITLE,
  MORE_MENU_WIDTH,
  UNAVAILABLE_WARNING,
} from "@/features/top-bar/MoreMenu.constants";
import type { TopBarMoreOption } from "@/features/top-bar/useTopBar.types";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import { ModalFrame } from "@/ui/ModalFrame";

/**
 * Renders the More remote actions menu as a modal select.
 *
 * Each option carries the explicit command id it dispatches and a description that is the
 * availability reason when the option cannot run. Selecting an unavailable option keeps the menu
 * open and shows the reason in a subdued warning line, so the user never loses the list; selecting
 * an available option closes through the caller and dispatches that option's command id. The menu
 * never replays a raw key and never reads another feature's cursor.
 *
 * The overlay-scope navigation handlers are registered even though the native select consumes
 * Up/Down and Enter while it is focused. They give the footer's modal hint set a handler for the
 * keys the menu advertises, and they keep the menu inert rather than falling through if focus lands
 * outside the select.
 *
 * @param props - Options with availability and the explicit-command handler.
 * @returns The More menu modal.
 */
export function MoreMenu(props: {
  readonly options: readonly TopBarMoreOption[];
  readonly onSelect: (commandId: string) => void;
}): ReactNode {
  const tokens = useTokens();
  const [selectedCommandId, setSelectedCommandId] = useState<string | null>(null);
  const selectedOption =
    selectedCommandId === null
      ? null
      : (props.options.find((option) => option.commandId === selectedCommandId) ?? null);
  // Derive the warning from the current option list instead of storing a reason string. A repository
  // read that settles while the menu is open can make the selected option available, and the warning
  // must disappear with it rather than keep explaining a stale state.
  const warning =
    selectedOption !== null && !selectedOption.available
      ? (selectedOption.reason ?? UNAVAILABLE_WARNING)
      : null;

  /** Handles a native select activation without letting an unavailable option run. */
  const handleSelect = useCallback(
    (index: number): void => {
      const option = props.options[index];

      if (option === undefined) {
        return;
      }

      if (!option.available) {
        setSelectedCommandId(option.commandId);
        return;
      }

      setSelectedCommandId(null);
      props.onSelect(option.commandId);
    },
    [props.options, props.onSelect],
  );

  /** Keeps the overlay-scope activation key advertised; the native select owns the real selection. */
  const activate = useCallback((): void => {}, []);
  /** Keeps the overlay-scope Up key advertised and inert outside the native select. */
  const moveUp = useCallback((): void => {}, []);
  /** Keeps the overlay-scope Down key advertised and inert outside the native select. */
  const moveDown = useCallback((): void => {}, []);

  useAction("nav.activate", { scope: "overlay" }, activate);
  useAction("nav.up", { scope: "overlay" }, moveUp);
  useAction("nav.down", { scope: "overlay" }, moveDown);

  return (
    <ModalFrame title={MORE_MENU_TITLE} width={MORE_MENU_WIDTH} height={MORE_MENU_HEIGHT}>
      <select
        id={MORE_MENU_SELECT_ID}
        flexGrow={1}
        options={props.options.map((option) => ({
          name: option.label,
          description: option.description,
          value: option.commandId,
        }))}
        showDescription
        wrapSelection={false}
        selectedIndex={0}
        onSelect={(index) => {
          handleSelect(index);
        }}
      />
      {warning === null ? null : (
        <text fg={tokens.dim} wrapMode="none">
          {`${ICONS.warning} ${warning}`}
        </text>
      )}
    </ModalFrame>
  );
}
