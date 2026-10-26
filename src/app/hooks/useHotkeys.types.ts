import type { InputMode } from "@/app/hooks/inputMode.types";
import type { ActionScope } from "@/app/hooks/useAction.types";
import type { KeyEventLike, ResolvedKeymap } from "@/domain/keymap/keymap.types";
import type { RegionId } from "@/features/shell/focus.types";

/** Inputs for one pure hotkey resolution pass. */
export interface HotkeyResolutionInput {
  /** The resolved keymap. */
  readonly keymap: ResolvedKeymap;
  /** The physical key event. */
  readonly key: KeyEventLike;
  /** Region that currently owns focus. */
  readonly activeRegion: RegionId | null;
  /** True while an editor owns focus. */
  readonly textInputFocused: boolean;
  /**
   * Routing mode declared by the focused text input, or null when it declares none.
   *
   * A `search` input keeps printable and editing keys, while the documented navigation keys resolve
   * to the owning region scope.
   */
  readonly textInputMode?: InputMode | null;
  /** True while a native select widget owns focus. */
  readonly nativeListFocused: boolean;
  /**
   * True while the focused renderable is inside a region frame.
   *
   * When false and no overlay owns keys, resolution falls back to globals only so a hidden or
   * unmounted region cannot answer for focus it no longer has. Defaults to true for callers that
   * only exercise region resolution.
   */
  readonly focusInsideRegion?: boolean;
  /** True while an overlay owns the keyboard. */
  readonly overlayOpen: boolean;
  /** Action id that toggles the open overlay, when the overlay declares one. */
  readonly overlayToggleActionId?: string;
}

/** One resolved action and the scope that should run it. */
export interface HotkeyResolution {
  /** Action to run. */
  readonly actionId: string;
  /** Scope whose handler should run. */
  readonly scope: ActionScope;
}
