import {
	createContext,
	useContext,
	useEffect,
	useRef,
	type RefObject,
} from 'react';
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

/** Ancestor count; the innermost of two overlapping elements has the greater. */
const depthOf = (element: DOMElement): number => {
	let depth = 0;
	let node: DOMElement | undefined = element.parentNode;
	while (node !== undefined) {
		depth += 1;
		node = node.parentNode;
	}

	return depth;
};

export type MouseScrollDirection = 'scrollup' | 'scrolldown';

export type MouseHandlers = {
	readonly onHover?: (hovered: boolean) => void;
	readonly onPress?: () => void;
	readonly onScroll?: (direction: MouseScrollDirection) => void;
};

/**
 * Base layer of every hit test: `false` means targets are eligible.
 *
 * The app provides `true` around the UI that sits under an overlay, and the
 * overlays themselves render outside that provider. Overlay rows are then the
 * only eligible targets while a dialog is open, so a click can never fall
 * through onto the Discard buttons the dialog is covering.
 */
export const MouseGateContext = createContext(false);

type TargetState = {
	handlers: MouseHandlers;
	blocked: boolean;
};

type Target = {
	readonly ref: RefObject<DOMElement>;
	readonly state: TargetState;
	readonly sequence: number;
};

/**
 * One flat registry for every mounted target.
 *
 * A registry instead of one listener pair per element is what makes
 * consumption possible: a single dispatch pass can compare all candidates and
 * pick the innermost one, where per-element listeners could only each test
 * their own rectangle and all fire. It also keeps the listener count constant
 * however many rows are on screen, which is why the app no longer raises
 * Node's default cap.
 */
const targets: Target[] = [];
let registrationSequence = 0;

const registerTarget = (target: Target): (() => void) => {
	targets.push(target);

	return () => {
		const index = targets.indexOf(target);
		if (index >= 0) {
			targets.splice(index, 1);
		}
	};
};

/**
 * The innermost target under the pointer that handles the given event.
 *
 * Greatest ancestor depth first; siblings are equally deep, so an accidental
 * overlap inside one row is broken by the smaller rectangle and then by the
 * later registration. One target consumes a click or a wheel event, and
 * nothing beneath it runs.
 */
const innermost = (
	position: Point,
	handler: 'onPress' | 'onScroll',
): Target | undefined => {
	let best: Target | undefined;
	let bestDepth = -1;
	let bestArea = 0;

	for (const target of targets) {
		if (target.state.blocked || target.state.handlers[handler] === undefined) {
			continue;
		}

		const element = target.ref.current;
		if (element === null || !hits(element, position)) {
			continue;
		}

		const { width, height } = measureElement(element);
		const area = Math.max(0, width) * Math.max(0, height);
		const depth = depthOf(element);
		const isBetter =
			best === undefined ||
			depth > bestDepth ||
			(depth === bestDepth && area < bestArea) ||
			(depth === bestDepth &&
				area === bestArea &&
				target.sequence > best.sequence);

		if (isBetter) {
			best = target;
			bestDepth = depth;
			bestArea = area;
		}
	}

	return best;
};

/**
 * Hover is reported to every eligible target, not just the innermost one.
 *
 * Rows highlight on hover and no two of them can be hovered at once anyway
 * (the pointer is in a single cell), so a full pass preserves today's exact
 * hover behaviour while making click and wheel single-owner events.
 */
const dispatchHover = (position: Point): void => {
	for (const target of targets) {
		const { onHover } = target.state.handlers;
		if (target.state.blocked || onHover === undefined) {
			continue;
		}

		const element = target.ref.current;
		if (element !== null) {
			onHover(hits(element, position));
		}
	}
};

const dispatchClick = (position: Point): void => {
	innermost(position, 'onPress')?.state.handlers.onPress?.();
};

const dispatchScroll = (
	position: Point,
	direction: MouseScrollDirection,
): void => {
	innermost(position, 'onScroll')?.state.handlers.onScroll?.(direction);
};

/**
 * Installs the single set of mouse listeners; renders nothing.
 *
 * Mount it once, inside `MouseProvider`. Every target registered through
 * `useMouseTarget` is dispatched from here.
 */
export function MouseDispatcher() {
	const { events } = useMouse();

	useEffect(() => {
		const handlePosition = (position: Point): void => {
			dispatchHover(position);
		};

		const handleClick = (position: Point, action: unknown): void => {
			if (action === 'press') {
				dispatchClick(position);
			}
		};

		const handleScroll = (position: Point, direction: unknown): void => {
			if (direction === 'scrollup' || direction === 'scrolldown') {
				dispatchScroll(position, direction);
			}
		};

		events.on('position', handlePosition);
		events.on('click', handleClick);
		events.on('scroll', handleScroll);

		return () => {
			events.off('position', handlePosition);
			events.off('click', handleClick);
			events.off('scroll', handleScroll);
		};
	}, [events]);

	return null;
}

/**
 * Registers one hit target while the component declares a handler.
 *
 * The handlers and the gate flag are kept in a ref and read at dispatch time,
 * so they always see the latest props instead of the ones from the render that
 * first subscribed. A component with no handlers is not registered at all:
 * diff body rows declare no action, and an inert rectangle would only cost
 * every dispatch pass. The effect re-runs and registers if a handler appears.
 */
export const useMouseTarget = (
	ref: RefObject<DOMElement>,
	handlers: MouseHandlers,
): void => {
	const blocked = useContext(MouseGateContext);
	const stateRef = useRef<TargetState>({ handlers, blocked });
	stateRef.current.handlers = handlers;
	stateRef.current.blocked = blocked;
	const hasHandlers =
		handlers.onHover !== undefined ||
		handlers.onPress !== undefined ||
		handlers.onScroll !== undefined;

	useEffect(() => {
		if (!hasHandlers) {
			return;
		}

		registrationSequence += 1;
		return registerTarget({
			ref,
			state: stateRef.current,
			sequence: registrationSequence,
		});
	}, [ref, hasHandlers]);
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
