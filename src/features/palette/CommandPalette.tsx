import { type ReactNode, useMemo } from "react";
import {
  PALETTE_SEARCH_INPUT_ID,
  PALETTE_SEARCH_PLACEHOLDER,
  PALETTE_SELECT_ID,
  PALETTE_TITLE,
  PALETTE_WIDTH,
} from "@/features/palette/CommandPalette.constants";
import type { CommandPaletteProps } from "@/features/palette/CommandPalette.types";
import { useCommandPalette } from "@/features/palette/useCommandPalette";
import { truncateText } from "@/lib/text";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import { KeyHint } from "@/ui/KeyHint";
import { ModalFrame } from "@/ui/ModalFrame";
import { SearchField } from "@/ui/SearchField";
import { SelectField } from "@/ui/SelectField";

/**
 * Renders the command palette modal content.
 *
 * The overlay host supplies the entry and the close callback, so this component only composes the
 * modal frame, the search field, the native result select, the no-match row, and the key hint strip.
 * The result list is a native `<select>`, as the architecture requires: group headers and command
 * rows are its options, the option name carries the category prefix, and an unavailable command's
 * description is its exact shared reason. The search field owns the `search` input mode, so query
 * typing stays in the field while Up, Down, PageUp, PageDown, and Enter route to the palette.
 *
 * @param props - Overlay close callback.
 * @returns The command palette modal.
 */
export function CommandPalette(props: CommandPaletteProps): ReactNode {
  const tokens = useTokens();
  const palette = useCommandPalette({ onClose: props.onClose });
  const options = useMemo(
    () =>
      palette.options.map((option) => ({
        label: option.name,
        description: option.description,
        value: option.value,
      })),
    [palette.options],
  );

  return (
    <ModalFrame title={PALETTE_TITLE} width={PALETTE_WIDTH}>
      <SearchField
        id={PALETTE_SEARCH_INPUT_ID}
        value={palette.query}
        placeholder={PALETTE_SEARCH_PLACEHOLDER}
        onInput={palette.setQuery}
      />
      {palette.matchCount === 0 ? (
        <text fg={tokens.dim} wrapMode="word">
          {readEmptyPaletteMessage(palette.query)}
        </text>
      ) : (
        <SelectField
          id={PALETTE_SELECT_ID}
          options={options}
          selectedIndex={palette.highlightedIndex}
          height={Math.min(palette.optionRows, options.length * 2)}
          onChange={palette.highlightOption}
          onSelect={palette.selectValue}
        />
      )}
      <box flexDirection="row" flexShrink={0} paddingLeft={1} gap={2}>
        <KeyHint keyLabel={palette.hints.activate} label="Run" />
        <KeyHint keyLabel={palette.hints.close} label="Close" />
        <KeyHint keyLabel={palette.hints.nextField} label="Next field" />
      </box>
    </ModalFrame>
  );
}

/**
 * Reads the no-match message.
 *
 * The marker comes from `ICONS`, so the palette never inlines a reusable glyph. The budget keeps a
 * very long query from overflowing the modal line.
 *
 * @param query - Current search text.
 * @returns The message rendered when no command matches.
 */
function readEmptyPaletteMessage(query: string): string {
  return truncateText(
    `${ICONS.missingUpstream} No matching commands "${query}"`,
    120,
    ICONS.ellipsis,
  );
}
