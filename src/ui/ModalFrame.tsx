import type { ReactNode } from "react";
import { useTokens } from "@/theme/useTokens";
import {
  MODAL_CONTENT_GAP,
  MODAL_CONTENT_PADDING,
  MODAL_FRAME_ID,
  MODAL_HORIZONTAL_INSET,
  MODAL_MIN_HEIGHT,
  MODAL_MIN_WIDTH,
  MODAL_VERTICAL_INSET,
} from "@/ui/ModalFrame.constants";
import { useTerminalDimensions } from "@/ui/useTerminalDimensions";

/**
 * Renders the reusable centered modal frame.
 *
 * The frame is absolutely positioned above the overlay layer, centered with a full-size alignment
 * wrapper, and clamped to the terminal so a small terminal still shows a usable modal instead of
 * overflowing it. It is focusable with a stable id, so the overlay host can move native focus into
 * the modal and the focus trap comes from native focus rather than a custom key loop. The component
 * is presentational: it owns no feature logic and no action registrations. Without an explicit
 * height it fits its content, bounded by the terminal. All dialogs share inset content and a
 * one-row gap; dense, explicitly budgeted dialogs can override the gap.
 *
 * @param props - Title, optional description, optional children, requested width and height, stable
 * id, content gap, and whether the frame shows its focused border.
 * @returns The modal frame.
 */
export function ModalFrame(props: {
  readonly title: string;
  readonly description?: string;
  readonly children?: ReactNode;
  readonly width: number;
  readonly height?: number;
  readonly gap?: number;
  readonly id?: string;
  readonly focused?: boolean;
}): ReactNode {
  const tokens = useTokens();
  const dimensions = useTerminalDimensions();
  const width = clampModalWidth(props.width, dimensions.width);
  const height = clampModalHeight(props.height, dimensions.height);
  const focused = props.focused ?? true;

  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      zIndex={20}
      justifyContent="center"
      alignItems="center"
    >
      <box
        id={props.id ?? MODAL_FRAME_ID}
        width={width}
        height={props.height === undefined ? undefined : height}
        maxHeight={height}
        minHeight={Math.min(MODAL_MIN_HEIGHT, height)}
        padding={MODAL_CONTENT_PADDING}
        gap={props.gap ?? MODAL_CONTENT_GAP}
        border
        flexDirection="column"
        focusable
        focusedBorderColor={tokens.focus}
        borderColor={focused ? tokens.focus : tokens.border}
        backgroundColor={tokens.surface}
        title={` ${props.title} `}
        titleColor={focused ? tokens.text : tokens.muted}
      >
        {props.description === undefined ? null : (
          <text fg={tokens.muted} wrapMode="word">
            {props.description}
          </text>
        )}
        {props.children}
      </box>
    </box>
  );
}

/**
 * Clamps a requested modal width to the terminal.
 *
 * @param requested - Requested width in cells.
 * @param terminalWidth - Current terminal width in cells.
 * @returns A width that fits the terminal with the documented inset.
 */
function clampModalWidth(requested: number, terminalWidth: number): number {
  const available = Math.max(1, terminalWidth - MODAL_HORIZONTAL_INSET * 2);

  return Math.min(Math.max(MODAL_MIN_WIDTH, requested), available, terminalWidth);
}

/**
 * Clamps a requested modal height to the terminal.
 *
 * @param requested - Requested height in rows, or undefined for content sizing up to the terminal.
 * @param terminalHeight - Current terminal height in rows.
 * @returns A height that fits the terminal with the documented inset.
 */
function clampModalHeight(requested: number | undefined, terminalHeight: number): number {
  const available = Math.max(1, terminalHeight - MODAL_VERTICAL_INSET * 2);
  const target = requested ?? available;

  return Math.min(Math.max(MODAL_MIN_HEIGHT, target), available, terminalHeight);
}
