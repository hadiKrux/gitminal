import type { BoxRenderable } from "@opentui/core";
import type { ReactNode, RefObject } from "react";

/** Every focusable region in the application shell. */
export type RegionId =
  | "top-bar"
  | "branches"
  | "remotes"
  | "tags"
  | "stashes"
  | "worktrees"
  | "graph"
  | "right-pane"
  | "diff"
  | "console";

/** Regions that live inside the five-panel sidebar stack. */
export type SidebarRegionId = "branches" | "remotes" | "tags" | "stashes" | "worktrees";

/**
 * Layout modes produced by the responsive gate.
 *
 * `full` and `narrow` show every region. `sidebar-collapsed` shows one sidebar panel selected by
 * the native switcher. `too-small` replaces the shell with the minimum-size notice.
 */
export type LayoutMode = "full" | "narrow" | "sidebar-collapsed" | "too-small";

/** A layout mode that renders the shell. */
export type ShellLayoutMode = Exclude<LayoutMode, "too-small">;

/**
 * A stable cursor identity for a region.
 *
 * Panels key their cursor by the item identity they already have, such as a branch name, commit
 * hash, or file path, so refreshing a list does not reset the cursor when the item survives.
 */
export type RegionCursor = string;

/**
 * One sidebar panel surface supplied by the composition root.
 *
 * The shell and the sidebar share this descriptor so a panel change is one edit. The content is a
 * `ReactNode` because the composition root, not the shell, imports the panel feature.
 */
export interface SidebarPanel {
  /** Region the panel frame represents. */
  readonly regionId: SidebarRegionId;
  /** Border title, including the row count the panel renders. */
  readonly label: string;
  /**
   * Plain section name for the collapsed switcher tabs.
   *
   * The border title keeps the count, while the compact tab labels stay short enough for the
   * switcher width and never repeat the count. Falls back to `label` when omitted.
   */
  readonly shortLabel?: string;
  /** Panel body. */
  readonly content: ReactNode;
}

/**
 * The projection of OpenTUI native focus held by `FocusProvider`.
 *
 * `activeRegion` is derived from the focused renderable's nearest ancestor region frame. It keeps
 * its last value while focus is outside every region, such as inside an overlay. `focusInsideRegion`
 * distinguishes that case so a region can report itself unfocused while a modal owns keys.
 */
export interface FocusState {
  /** Region that owns the focused renderable, or the last region that owned focus. */
  readonly activeRegion: RegionId | null;
  /** Region that owned focus before the current one. */
  readonly previousRegion: RegionId | null;
  /** Id of the currently focused renderable. */
  readonly focusedRenderableId: string | null;
  /** Id of the renderable that had focus before the current one. */
  readonly previousFocusedRenderableId: string | null;
  /** True while an `EditBufferRenderable` owns native focus. */
  readonly textInputFocused: boolean;
  /** True while the focused editor is a multiline textarea. */
  readonly multilineInputFocused: boolean;
  /** True while a native `SelectRenderable` or `TabSelectRenderable` owns focus. */
  readonly nativeListFocused: boolean;
  /** True while the focused renderable is inside a region frame. */
  readonly focusInsideRegion: boolean;
}

/** Value exposed by `FocusProvider` and read through `useFocusState`. */
export interface FocusContextValue {
  /** The derived focus projection. */
  readonly state: FocusState;
  /** Focuses the frame of one region and reports whether the frame was mounted. */
  readonly focusRegion: (regionId: RegionId) => boolean;
  /** Focuses a renderable by id and reports whether it was found. */
  readonly focusRenderable: (id: string) => boolean;
  /** Restores a captured renderable, falling back to its previous region frame. */
  readonly restoreFocus: (id: string) => void;
  /** Re-derives the projection after a region frame identity changes under native focus. */
  readonly refreshFocus: () => void;
  /** Reads the persisted cursor for a region. */
  readonly getCursor: (regionId: RegionId) => RegionCursor | null;
  /** Writes or clears the persisted cursor for a region. */
  readonly setCursor: (regionId: RegionId, cursor: RegionCursor | null) => void;
}

/**
 * Options accepted by `useFocusModel`.
 *
 * The hook owns traversal and direct jumps only; the caller keeps the collapsed panel selection
 * and console visibility because both are shell view state.
 */
export interface FocusModelOptions {
  /** Current shell layout mode. */
  readonly layoutMode: ShellLayoutMode;
  /** Selected sidebar panel in the collapsed layout. */
  readonly activeSidebarPanel: number;
  /** Selects a panel in the collapsed sidebar switcher. */
  readonly onSelectSidebarPanel: (index: number) => void;
  /** Whether the console drawer is currently open. */
  readonly consoleOpen: boolean;
  /** Opens the console drawer before it receives focus. */
  readonly onOpenConsole: () => void;
}

/** Navigation helpers returned by `useFocusModel`. */
export interface FocusModel {
  /** Moves focus to the next visible region, wrapping at the end. */
  readonly focusNext: () => void;
  /** Moves focus to the previous visible region, wrapping at the start. */
  readonly focusPrevious: () => void;
  /** Focuses one region directly and reports whether its frame was mounted. */
  readonly focusRegion: (regionId: RegionId) => boolean;
}

/** Result returned by `useFocusRegion`. */
export interface FocusRegionHandle {
  /** True when this region or a descendant owns focus. */
  readonly focused: boolean;
  /** Focuses the region frame. */
  readonly focus: () => void;
  /** Props that turn a box into the stable region frame. */
  readonly regionProps: {
    readonly id: string;
    readonly ref: RefObject<BoxRenderable | null>;
    readonly focusable: true;
    readonly borderColor: string;
    readonly focusedBorderColor: string;
  };
  /** Reads the region cursor persisted by `FocusProvider`. */
  readonly getCursor: () => RegionCursor | null;
  /** Writes or clears the region cursor. */
  readonly setCursor: (cursor: RegionCursor | null) => void;
}
