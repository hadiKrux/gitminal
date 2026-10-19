import React, { useEffect, useRef, useState } from 'react';
import { Box, type DOMElement } from 'ink';
import { ScrollView, type ScrollViewRef } from 'ink-scroll-view';
import { useMouse } from '@zenobius/ink-mouse';
import { useKeyboardShortcuts } from '../hooks/use-keyboard-shortcuts.js';
import { useMouseHover } from '../hooks/use-mouse.js';
import Scrollbar from './scrollbar.js';

type Props = {
	/** Total width, including the one-column scrollbar. */
	readonly width: number;
	/** Viewport height in rows. */
	readonly height: number;
	/** When false, e.g. while an overlay owns input, scrolling is disabled. */
	readonly isActive?: boolean;
	/** Rows scrolled per arrow press. */
	readonly step?: number;
	/** Receives the inner content width (the area left of the scrollbar). */
	readonly children: (contentWidth: number) => React.ReactNode;
};

/** Columns reserved on the right for the scrollbar. */
const scrollbarWidth = 1;
/**
 * Rows scrolled per wheel event. Kept small because terminals emit several
 * scroll events per physical notch, so a larger step overshoots.
 */
const wheelStep = 1;

/**
 * A vertically scrollable viewport with a scrollbar.
 *
 * Scrolls from the arrow keys (by `step` rows) and the mouse wheel (only while
 * the pointer is over the area). Both are disabled while an overlay is open.
 */
export default function ScrollableArea({
	width,
	height,
	isActive = true,
	step = 1,
	children,
}: Props) {
	const viewportHeight = Math.max(1, height);
	const contentWidth = Math.max(0, width - scrollbarWidth);

	const scrollRef = useRef<ScrollViewRef>(null);
	const containerRef = useRef<DOMElement>(null);
	// A ref, not state: the scroll event and its position update arrive in the
	// same tick, so reading state here would miss the very first wheel event.
	const isHoveredRef = useRef(false);
	const { events } = useMouse();

	const [offset, setOffset] = useState(0);
	const [contentHeight, setContentHeight] = useState(0);

	const scrollBy = (delta: number): void => {
		const view = scrollRef.current;
		if (view === null) {
			return;
		}

		// The library clamps scrollBy to the content height, which lets the list
		// scroll past its own end into empty space. Clamp to the real bottom.
		const next = view.getScrollOffset() + delta;
		view.scrollTo(Math.max(0, Math.min(next, view.getBottomOffset())));
	};

	useKeyboardShortcuts(
		{
			'move-down'() {
				scrollBy(step);
			},
			'move-up'() {
				scrollBy(-step);
			},
		},
		{ isActive },
	);

	useMouseHover(containerRef, hovered => {
		isHoveredRef.current = hovered;
	});

	useEffect(() => {
		if (!isActive) {
			return;
		}

		const handleScroll = (_position: unknown, direction: unknown): void => {
			if (!isHoveredRef.current) {
				return;
			}

			if (direction === 'scrolldown') {
				scrollBy(wheelStep);
			} else if (direction === 'scrollup') {
				scrollBy(-wheelStep);
			}
		};

		events.on('scroll', handleScroll);
		return () => {
			events.off('scroll', handleScroll);
		};
	}, [events, isActive]);

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
