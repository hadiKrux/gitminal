import type { ScrollBoxRenderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { type ReactNode, useEffect, useRef } from "react";
import { HelpConfiguration } from "@/features/help/HelpConfiguration";
import {
  HELP_BODY_ID,
  HELP_MODAL_CHROME_COLUMNS,
  HELP_MODAL_HEIGHT,
  HELP_MODAL_ID,
  HELP_MODAL_WIDTH,
  HELP_SEARCH_INPUT_ID,
  HELP_SEARCH_PLACEHOLDER,
  HELP_TITLE,
} from "@/features/help/HelpModal.constants";
import type { HelpModalProps } from "@/features/help/HelpModal.types";
import { HelpSection } from "@/features/help/HelpSection";
import { useHelp } from "@/features/help/useHelp";
import { HELP_ROW_ID_PREFIX } from "@/features/help/useHelp.constants";
import { truncateText } from "@/lib/text";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import { KeyHint } from "@/ui/KeyHint";
import { ModalFrame } from "@/ui/ModalFrame";
import { SearchField } from "@/ui/SearchField";

/**
 * Renders the help modal content.
 *
 * The overlay host supplies the entry and the close callback, so the component composes the modal
 * frame, the search field, one `HelpSection` per section in the hook's order, and the footer hints.
 * The body is a single `<scrollbox>` with `viewportCulling`, and the row cursor keeps its row inside
 * that viewport. The Configuration section renders `HelpConfiguration` instead of rows. Collapsing a
 * section keeps its header visible, and the no-match state only replaces the body when the query
 * the rows were filtered by is non-empty and matches nothing, so the guard and the match count
 * always read the same query. Every key is
 * an action id handled by `useHelp`: `/` focuses the search field, Esc clears the search and then
 * closes, and the navigation keys move the row cursor. The footer advertises the effective bindings,
 * never a hardcoded key.
 *
 * @param props - Overlay close callback.
 * @returns The help modal.
 */
export function HelpModal(props: HelpModalProps): ReactNode {
  const tokens = useTokens();
  const dimensions = useTerminalDimensions();
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const help = useHelp({ onClose: props.onClose });
  const width = Math.max(
    20,
    Math.min(HELP_MODAL_WIDTH, dimensions.width) - HELP_MODAL_CHROME_COLUMNS,
  );

  useEffect(() => {
    if (help.selectedActionId === null) {
      return;
    }

    scrollRef.current?.scrollChildIntoView(`${HELP_ROW_ID_PREFIX}${help.selectedActionId}`);
  }, [help.selectedActionId]);

  return (
    <ModalFrame
      id={HELP_MODAL_ID}
      title={HELP_TITLE}
      width={HELP_MODAL_WIDTH}
      height={HELP_MODAL_HEIGHT}
    >
      <SearchField
        id={HELP_SEARCH_INPUT_ID}
        value={help.query}
        placeholder={HELP_SEARCH_PLACEHOLDER}
        onInput={help.setQuery}
      />
      <scrollbox
        ref={scrollRef}
        id={HELP_BODY_ID}
        flexGrow={1}
        flexShrink={1}
        focusable={false}
        viewportCulling
      >
        {help.matchCount === 0 && help.hasQuery ? (
          <text fg={tokens.dim} wrapMode="word">
            {readEmptyHelpMessage(help.query)}
          </text>
        ) : (
          help.sections.map((section) => (
            <HelpSection
              key={section.id}
              section={section}
              width={width}
              selectedActionId={help.selectedActionId}
              onToggle={() => {
                help.toggleSection(section.id);
              }}
              onSelect={help.selectRow}
            >
              {section.id === "configuration" ? <HelpConfiguration /> : null}
            </HelpSection>
          ))
        )}
      </scrollbox>
      <box flexDirection="row" flexShrink={0} height={1} paddingLeft={1} gap={2}>
        <KeyHint keyLabel={help.hints.search} label="Search" />
        <KeyHint keyLabel={help.hints.close} label="Clear/Close" />
        <KeyHint keyLabel={help.hints.navigate} label="Navigate" />
      </box>
    </ModalFrame>
  );
}

/**
 * Reads the no-match message.
 *
 * The marker comes from `ICONS`, so help never inlines a reusable glyph, and the query is echoed so
 * the user can see what did not match.
 *
 * @param query - Current search text.
 * @returns The message rendered when no action matches.
 */
function readEmptyHelpMessage(query: string): string {
  return truncateText(`${ICONS.missingUpstream} No actions match "${query}"`, 120, ICONS.ellipsis);
}
