import type { ScrollBoxRenderable } from "@opentui/core";
import type { ReactNode, Ref } from "react";
import { useTokens } from "@/theme/useTokens";

/**
 * Renders a plain scroll container for short or moderate content.
 *
 * The scrollbox is not focusable because the owning region frame owns native focus. A caller that
 * needs keyboard scrolling passes a typed scroll ref and registers its own region or overlay
 * actions, so the scroll position stays under that surface's control. Mouse wheel and scrollbar
 * drag remain available without any caller work.
 *
 * @param props - Content, optional id, scroll ref, size-change callback, flex grow factor, fixed
 * height, and culling.
 * @returns The scroll container.
 */
export function ScrollableList(props: {
  readonly children?: ReactNode;
  readonly id?: string;
  readonly scrollRef?: Ref<ScrollBoxRenderable>;
  readonly onSizeChange?: () => void;
  readonly flexGrow?: number;
  readonly height?: number;
  readonly viewportCulling?: boolean;
}): ReactNode {
  const tokens = useTokens();

  return (
    <scrollbox
      id={props.id}
      ref={props.scrollRef}
      onSizeChange={props.onSizeChange}
      height={props.height}
      flexGrow={props.flexGrow ?? 1}
      flexShrink={1}
      focusable={false}
      viewportCulling={props.viewportCulling ?? false}
      scrollbarOptions={{ trackOptions: { foregroundColor: tokens.scrollbar } }}
    >
      {props.children}
    </scrollbox>
  );
}
