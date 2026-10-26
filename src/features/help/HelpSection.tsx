import type { ReactNode } from "react";
import { HelpRow } from "@/features/help/HelpRow";
import { HELP_SECTION_ID_PREFIX } from "@/features/help/useHelp.constants";
import type { HelpSectionView } from "@/features/help/useHelp.types";
import { SectionHeader } from "@/ui/SectionHeader";

/**
 * Renders one titled help section with its rows.
 *
 * The header is the shared `SectionHeader` primitive, so the expand and collapse markers come from
 * `ICONS` and the section state reads without color. The body renders the supplied children, which
 * the Configuration section uses for its path, warning, and note block, followed by one `HelpRow`
 * per action. A collapsed section renders its header only.
 *
 * @param props - Section data, row width, selected action, toggle and select callbacks, and optional body children.
 * @returns The composed help section.
 */
export function HelpSection(props: {
  readonly section: HelpSectionView;
  readonly width: number;
  readonly selectedActionId: string | null;
  readonly onToggle: () => void;
  readonly onSelect: (actionId: string) => void;
  readonly children?: ReactNode;
}): ReactNode {
  return (
    <box flexDirection="column" flexShrink={0}>
      <SectionHeader
        id={`${HELP_SECTION_ID_PREFIX}${props.section.id}`}
        title={props.section.title}
        expanded={!props.section.collapsed}
        onMouseDown={props.onToggle}
      />
      {props.section.collapsed ? null : (
        <>
          {props.children}
          {props.section.rows.map((row) => (
            <HelpRow
              key={row.actionId}
              row={row}
              width={props.width}
              selected={row.actionId === props.selectedActionId}
              onSelect={() => {
                props.onSelect(row.actionId);
              }}
            />
          ))}
        </>
      )}
    </box>
  );
}
