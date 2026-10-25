import {
  type CliRenderer,
  InputRenderable,
  type Renderable,
  SelectRenderable,
  TabSelectRenderable,
  TextareaRenderable,
} from "@opentui/core";
import { useRenderer } from "@opentui/react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  FocusContextValue,
  FocusState,
  RegionCursor,
  RegionId,
} from "@/features/shell/focus.types";
import { regionFrameId, regionFromFrameId } from "@/features/shell/regions";

/** Focus projection before any renderable receives focus. */
const INITIAL_FOCUS_STATE: FocusState = Object.freeze({
  activeRegion: null,
  previousRegion: null,
  focusedRenderableId: null,
  previousFocusedRenderableId: null,
  textInputFocused: false,
  multilineInputFocused: false,
  nativeListFocused: false,
  focusInsideRegion: false,
});

/** Context carrying the derived focus projection. */
export const FocusContext = createContext<FocusContextValue | null>(null);

/**
 * Projects OpenTUI native focus into render-friendly shell state.
 *
 * The provider subscribes to `focused_renderable` and `focused_editor`, derives the owning region
 * from the focused renderable's nearest `region-<id>` ancestor, and keeps that region active while
 * focus sits outside every region, such as inside an overlay. It never exposes a writable
 * `activeRegion`: navigation calls `focusRegion` and the renderer completes the loop. It also owns
 * the per-region cursor map so a panel can persist its selection across focus changes.
 *
 * @param props - Provider content.
 * @returns The focus context provider.
 */
export function FocusProvider(props: { children?: ReactNode }): ReactNode {
  const renderer = useRenderer();
  const [state, setState] = useState<FocusState>(INITIAL_FOCUS_STATE);
  const cursors = useRef(new Map<RegionId, RegionCursor>());
  const lastRegionByRenderableId = useRef(new Map<string, RegionId>());

  /** Re-derives the focus projection from the renderer's current focus. */
  const syncFocus = useCallback(() => {
    const focused = renderer.currentFocusedRenderable;
    const region = findOwningRegion(focused);
    const focusedId = focused?.id ?? null;

    if (focusedId !== null && region !== null) {
      lastRegionByRenderableId.current.set(focusedId, region);
    }

    setState((previous) => {
      const next = deriveFocusState(renderer, previous, focused, region);

      return focusStatesEqual(previous, next) ? previous : next;
    });
  }, [renderer]);

  useEffect(() => {
    syncFocus();
    renderer.on("focused_renderable", syncFocus);
    renderer.on("focused_editor", syncFocus);

    return () => {
      renderer.off("focused_renderable", syncFocus);
      renderer.off("focused_editor", syncFocus);
    };
  }, [renderer, syncFocus]);

  /** Focuses a mounted renderable by id, reporting whether it was found. */
  const focusRenderable = useCallback(
    (id: string): boolean => {
      const target = renderer.root.findDescendantById(id);

      if (!target) {
        return false;
      }

      target.focus();

      return true;
    },
    [renderer],
  );

  /** Focuses a region's frame through its stable renderable id and reports whether it mounted. */
  const focusRegion = useCallback(
    (regionId: RegionId): boolean => focusRenderable(regionFrameId(regionId)),
    [focusRenderable],
  );

  /** Restores a captured renderable, falling back to the region it last belonged to. */
  const restoreFocus = useCallback(
    (id: string): void => {
      if (focusRenderable(id)) {
        return;
      }

      const region = lastRegionByRenderableId.current.get(id);

      if (region !== undefined) {
        focusRegion(region);
      }
    },
    [focusRenderable, focusRegion],
  );

  /** Reads the stored cursor key for a region. */
  const getCursor = useCallback((regionId: RegionId): RegionCursor | null => {
    return cursors.current.get(regionId) ?? null;
  }, []);

  /** Stores or clears the cursor key for a region. */
  const setCursor = useCallback((regionId: RegionId, cursor: RegionCursor | null): void => {
    if (cursor === null) {
      cursors.current.delete(regionId);
      return;
    }

    cursors.current.set(regionId, cursor);
  }, []);

  const value = useMemo<FocusContextValue>(
    () => ({
      state,
      focusRegion,
      focusRenderable,
      restoreFocus,
      refreshFocus: syncFocus,
      getCursor,
      setCursor,
    }),
    [state, focusRegion, focusRenderable, restoreFocus, syncFocus, getCursor, setCursor],
  );

  return <FocusContext.Provider value={value}>{props.children}</FocusContext.Provider>;
}

/**
 * Derives the next focus projection from the renderer and the previous projection.
 *
 * @param renderer - Active renderer, read for editor and focus-kind getters.
 * @param previous - Previous projection.
 * @param focused - Currently focused renderable.
 * @param region - Region that owns the focused renderable, or `null`.
 * @returns The next projection.
 */
function deriveFocusState(
  renderer: CliRenderer,
  previous: FocusState,
  focused: Renderable | null,
  region: RegionId | null,
): FocusState {
  return {
    activeRegion: region ?? previous.activeRegion,
    previousRegion:
      region !== null && region !== previous.activeRegion
        ? previous.activeRegion
        : previous.previousRegion,
    focusedRenderableId: focused?.id ?? null,
    previousFocusedRenderableId: previous.focusedRenderableId,
    textInputFocused: renderer.currentFocusedEditor !== null,
    multilineInputFocused:
      renderer.currentFocusedEditor instanceof TextareaRenderable &&
      !(renderer.currentFocusedEditor instanceof InputRenderable),
    nativeListFocused:
      focused instanceof SelectRenderable || focused instanceof TabSelectRenderable,
    focusInsideRegion: region !== null,
  };
}

/**
 * Walks the renderable ancestry to find the nearest region frame.
 *
 * @param renderable - Focused renderable, or `null`.
 * @returns The owning region id, or `null` when no region ancestor exists.
 */
function findOwningRegion(renderable: Renderable | null): RegionId | null {
  let current: Renderable | null = renderable;

  while (current !== null) {
    const region = regionFromFrameId(current.id);

    if (region !== null) {
      return region;
    }

    current = current.parent;
  }

  return null;
}

/**
 * Compares two projections to avoid re-rendering consumers on unrelated focus events.
 *
 * @param left - First projection.
 * @param right - Second projection.
 * @returns True when every field matches.
 */
function focusStatesEqual(left: FocusState, right: FocusState): boolean {
  return (
    left.activeRegion === right.activeRegion &&
    left.previousRegion === right.previousRegion &&
    left.focusedRenderableId === right.focusedRenderableId &&
    left.previousFocusedRenderableId === right.previousFocusedRenderableId &&
    left.textInputFocused === right.textInputFocused &&
    left.multilineInputFocused === right.multilineInputFocused &&
    left.nativeListFocused === right.nativeListFocused &&
    left.focusInsideRegion === right.focusInsideRegion
  );
}
