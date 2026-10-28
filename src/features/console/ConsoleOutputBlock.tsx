import type { ReactNode } from "react";
import { parseConsoleOmittedMarker } from "@/domain/console/console.buffer";
import { CONSOLE_OUTPUT_MAX_ROWS } from "@/domain/console/console.constants";
import type { ConsoleOutputBlock as ConsoleOutputBlockData } from "@/domain/console/console.types";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import { useScrollbarOptions } from "@/ui/useScrollbarOptions";

/**
 * Renders one labelled output block with its omitted-lines marker.
 *
 * The block is a bounded `<scrollbox>`, so a long git output scrolls inside its pane instead of
 * growing the entry without limit. The domain buffer already capped the block and put a counted
 * marker between its head and tail; this component replaces that marker line with the shared
 * `ICONS.omittedLines` text so the visible marker comes from the icon catalogue.
 *
 * @param props - Output label and capped block.
 * @returns The bordered output pane.
 */
export function ConsoleOutputBlock(props: {
  readonly label: string;
  readonly block: ConsoleOutputBlockData;
}): ReactNode {
  const tokens = useTokens();
  const scrollbarOptions = useScrollbarOptions();
  const height = readBlockHeight(props.block);
  const parts = splitBlockAtMarker(props.block);

  return (
    <box flexDirection="column" marginTop={0}>
      <text fg={tokens.muted} wrapMode="none">
        {props.label}
      </text>
      <scrollbox
        height={height}
        flexShrink={0}
        focusable={false}
        viewportCulling
        scrollbarOptions={scrollbarOptions}
      >
        <text fg={tokens.text} wrapMode="word">
          {parts.head}
        </text>
        {parts.marker === null ? null : (
          <text fg={tokens.dim} wrapMode="none">
            {parts.marker}
          </text>
        )}
        {parts.tail.length === 0 ? null : (
          <text fg={tokens.text} wrapMode="word">
            {parts.tail}
          </text>
        )}
      </scrollbox>
    </box>
  );
}

/**
 * Reads the visible height of one output pane.
 *
 * @param block - Capped output block.
 * @returns At least one row, capped at the documented maximum.
 */
function readBlockHeight(block: ConsoleOutputBlockData): number {
  const lines = block.text.split("\n").length;

  return Math.min(CONSOLE_OUTPUT_MAX_ROWS, Math.max(1, lines));
}

/**
 * Splits a capped block around its omitted-lines marker.
 *
 * @param block - Capped output block.
 * @returns The head text, the marker text from `ICONS`, and the tail text.
 */
function splitBlockAtMarker(block: ConsoleOutputBlockData): {
  readonly head: string;
  readonly marker: string | null;
  readonly tail: string;
} {
  if (block.omittedLines <= 0) {
    return { head: block.text, marker: null, tail: "" };
  }

  const lines = block.text.split("\n");
  const markerIndex = lines.findIndex((line) => parseConsoleOmittedMarker(line) !== null);

  if (markerIndex < 0) {
    return { head: block.text, marker: null, tail: "" };
  }

  return {
    head: lines.slice(0, markerIndex).join("\n"),
    marker: ICONS.omittedLines.replace("N", String(block.omittedLines)),
    tail: lines.slice(markerIndex + 1).join("\n"),
  };
}
