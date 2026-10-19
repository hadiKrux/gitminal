import { useEffect, useRef, type RefObject } from 'react';
import { measureElement, type DOMElement } from 'ink';
import { useMouse } from '@zenobius/ink-mouse';

type Point = {
	readonly x: number;
	readonly y: number;
};

type ComputedLayout = {
	readonly left: number;
	readonly top: number;
};

/**
 * Read a node's layout.
 *
 * yoga-layout's declarations do not resolve under this project's module
 * settings, so Ink hands the yoga node back as `any`; the shape is reasserted
 * here rather than letting `any` spread through the arithmetic below.
 */
const computedLayout = (node: DOMElement): ComputedLayout => {
	const yoga = node.yogaNode as
		| { getComputedLayout: () => ComputedLayout }
		| undefined;
	return yoga?.getComputedLayout() ?? { left: 0, top: 0 };
};

/**
 * Absolute position of an element in Ink's zero-based layout space, walking up
 * through every ancestor's own offset.
 */
const absolutePosition = (element: DOMElement): Point => {
	let left = 0;
	let top = 0;
	let node: DOMElement | undefined = element;
	while (node !== undefined) {
		const layout = computedLayout(node);
		left += layout.left;
		top += layout.top;
		node = node.parentNode;
	}

	return { x: left, y: top };
};

/**
 * Whether a mouse position lands on an element.
 *
 * Both the element rectangle and the position are read fresh on every event.
 * Rows expand and collapse and lists scroll, so a rectangle cached when the
 * element mounted goes stale and starts matching the wrong cell. The mouse is
 * reported one-based while the layout is zero-based, so it is shifted first;
 * without that the whole rectangle is a cell up and to the left, which lights
 * up the element above or beside the pointer.
 */
const hits = (element: DOMElement, mouse: Point): boolean => {
	const { x, y } = absolutePosition(element);
	const { width, height } = measureElement(element);
	const column = mouse.x - 1;
	const row = mouse.y - 1;
	return column >= x && column < x + width && row >= y && row < y + height;
};

type Handlers = {
	readonly onHover?: (hovered: boolean) => void;
	readonly onPress?: () => void;
};

/**
 * Binds hover and click handlers to an element for the life of the component.
 *
 * The handlers are held in a ref and read at event time, so they always see the
 * latest props instead of the ones from the render that first subscribed.
 */
const useMouseTarget = (
	ref: RefObject<DOMElement>,
	handlers: Handlers,
): void => {
	const { events } = useMouse();
	const handlersRef = useRef(handlers);
	handlersRef.current = handlers;

	useEffect(() => {
		const handlePosition = (position: Point): void => {
			const element = ref.current;
			if (element !== null) {
				handlersRef.current.onHover?.(hits(element, position));
			}
		};

		const handleClick = (position: Point, action: unknown): void => {
			const element = ref.current;
			if (action === 'press' && element !== null && hits(element, position)) {
				handlersRef.current.onPress?.();
			}
		};

		events.on('position', handlePosition);
		events.on('click', handleClick);
		return () => {
			events.off('position', handlePosition);
			events.off('click', handleClick);
		};
	}, [events, ref]);
};

/** Calls `onChange` with whether the pointer is over the referenced element. */
export const useMouseHover = (
	ref: RefObject<DOMElement>,
	onChange: (hovered: boolean) => void,
): void => {
	useMouseTarget(ref, { onHover: onChange });
};

/** Calls `onPress` when the referenced element is pressed. */
export const useMouseClick = (
	ref: RefObject<DOMElement>,
	onPress: () => void,
): void => {
	useMouseTarget(ref, { onPress });
};
