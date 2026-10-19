import React, {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from 'react';
import { Box, type DOMElement } from 'ink';
import { ScrollView, type ScrollViewRef } from 'ink-scroll-view';
import { useKeyboardShortcuts } from '../hooks/use-keyboard-shortcuts.js';
import { useMouseTarget } from '../hooks/use-mouse.js';
import Scrollbar from './scrollbar.js';

export type ScrollableAreaHandle = {
	/** Scroll by `delta` rows, clamped to the real content bounds. */
	readonly scrollBy: (delta: number) => void;
	/**
	 * Scroll the minimum amount that brings the `index`-th direct child fully
	 * into view; a list that moves a selection uses this to keep the selected
	 * row visible without jumping the viewport.
	 */
	readonly reveal: (index: number) => void;
};

type Props = {
	/** Total width, including the one-column scrollbar. */
	readonly width: number;
	/** Viewport height in rows. */
	readonly height: number;
	/** When false, e.g. while an overlay owns input, scrolling is disabled. */
	readonly isActive?: boolean;
	/** Rows scrolled per arrow press. */
	readonly step?: number;
	/** Rows scrolled per page-up/page-down press; unbound when undefined. */
	readonly pageStep?: number;
	/**
	 * Whether the arrow keys scroll this area. A list whose arrows move a
	 * selection passes false so its own handler owns them; page-up/page-down
	 * still scroll when `pageStep` is given.
	 */
	// eslint-disable-next-line react/boolean-prop-naming
	readonly scrollOnArrows?: boolean;
	/**
	 * Follow new content to the bottom while the viewport is already there;
	 * opening forces one scroll so existing entries start at the bottom.
	 */
	// eslint-disable-next-line react/boolean-prop-naming
	readonly stickToBottom?: boolean;
	/** Receives the inner content width (the area left of the scrollbar). */
	readonly children: (contentWidth: number) => React.ReactNode;
};

/** Columns reserved on the right for the scrollbar. */
const scrollbarWidth = 1;
/**
 * Rows scrolled per wheel event. Kept small because terminals emit several
 * scroll events per physical notch, so a larger step overshoots.
 */
export const wheelStep = 1;

/**
 * A vertically scrollable viewport with a scrollbar.
 *
 * Scrolls from the arrow keys (by `step` rows) and the mouse wheel while the
 * pointer is over the area; both are disabled while an overlay owns input.
 * The imperative handle lets a surrounding panel forward wheel events from
 * cells outside this viewport (its border and padding) to the same scroll.
 */
function ScrollableAreaWithHandle(
	{
		width,
		height,
		isActive = true,
		step = 1,
		pageStep,
		scrollOnArrows = true,
		stickToBottom = false,
		children,
	}: Props,
	ref: React.ForwardedRef<ScrollableAreaHandle>,
) {
	const viewportHeight = Math.max(1, height);
	const contentWidth = Math.max(0, width - scrollbarWidth);

	const scrollRef = useRef<ScrollViewRef>(null);
	const containerRef = useRef<DOMElement>(null);

	const [offset, setOffset] = useState(0);
	const [contentHeight, setContentHeight] = useState(0);
	const previousContentHeight = useRef(0);

	const scrollBy = useCallback((delta: number): void => {
		const view = scrollRef.current;
		if (view === null) {
			return;
		}

		// The library clamps scrollBy to the content height, which lets the
		// list scroll past its own end into empty space. Clamp to the real
		// bottom.
		const next = view.getScrollOffset() + delta;
		view.scrollTo(Math.max(0, Math.min(next, view.getBottomOffset())));
	}, []);

	/**
	 * Bring one direct child fully into view with the smallest scroll.
	 *
	 * A selection moves one row at a time, so the target is usually already
	 * visible or just off an edge: only the overflow scrolls, and the same
	 * bottom clamp as `scrollBy` keeps the viewport from landing past the end
	 * of the list.
	 */
	const reveal = useCallback((index: number): void => {
		const view = scrollRef.current;
		if (view === null) {
			return;
		}

		const item = view.getItemPosition(index);
		if (item === null) {
			return;
		}

		const offset = view.getScrollOffset();
		const bottom = item.top + item.height;
		const viewportHeight = view.getViewportHeight();

		if (item.top < offset) {
			view.scrollTo(Math.max(0, Math.min(item.top, view.getBottomOffset())));
			return;
		}

		if (bottom > offset + viewportHeight) {
			view.scrollTo(
				Math.max(0, Math.min(bottom - viewportHeight, view.getBottomOffset())),
			);
		}
	}, []);

	useImperativeHandle(ref, () => ({ scrollBy, reveal }), [scrollBy, reveal]);

	// Follow growth only when the viewport was already at the bottom: a user
	// who scrolled up to read history must not be yanked back by the next
	// entry. The first measurement is the open case, so it always lands at
	// the bottom; shrinking content never moves the viewport.
	useEffect(() => {
		const previous = previousContentHeight.current;
		const wasAtBottom = offset + viewportHeight >= previous - 1;
		const isOpening = previous === 0;

		if (
			stickToBottom &&
			(isOpening || (contentHeight > previous && wasAtBottom))
		) {
			scrollRef.current?.scrollToBottom();
		}

		previousContentHeight.current = contentHeight;
	}, [contentHeight, offset, stickToBottom, viewportHeight]);

	useKeyboardShortcuts(
		{
			...(scrollOnArrows
				? {
						'move-down'() {
							scrollBy(step);
						},
						'move-up'() {
							scrollBy(-step);
						},
				  }
				: {}),
			...(pageStep === undefined
				? {}
				: {
						'page-down'() {
							scrollBy(pageStep);
						},
						'page-up'() {
							scrollBy(-pageStep);
						},
				  }),
		},
		{ isActive },
	);

	// The wheel only reaches the area under the pointer: the registry picks
	// the closest scroll target, so a wheel over this area never also scrolls
	// the other panel the way the arrow keys would.
	useMouseTarget(containerRef, {
		onScroll(direction) {
			if (!isActive) {
				return;
			}

			scrollBy(direction === 'scrolldown' ? wheelStep : -wheelStep);
		},
	});

	return (
		<Box
			ref={containerRef}
			flexDirection="row"
			width={width}
			height={viewportHeight}
		>
			<ScrollView
				ref={scrollRef}
				width={contentWidth}
				height={viewportHeight}
				onScroll={setOffset}
				onContentHeightChange={next => {
					setContentHeight(next);
				}}
			>
				{children(contentWidth)}
			</ScrollView>
			<Scrollbar
				height={viewportHeight}
				offset={offset}
				contentHeight={contentHeight}
			/>
		</Box>
	);
}

const ScrollableArea = forwardRef<ScrollableAreaHandle, Props>(
	ScrollableAreaWithHandle,
);

export default ScrollableArea;
