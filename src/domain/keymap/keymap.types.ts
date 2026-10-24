/** Platform families whose modifier conventions affect keymap resolution. */
export type KeymapPlatform = "macos" | "windows" | "linux";

/**
 * Focus contexts that can own a key binding.
 *
 * The region members are exactly the documented `RegionId` values from the architecture, so the
 * runtime dispatcher can use `FocusProvider.activeRegion` as a lookup key without an adapter.
 * `global` applies outside a region and `overlay` applies while a modal owns keys.
 */
export type KeymapContext =
  | "global"
  | "top-bar"
  | "branches"
  | "remotes"
  | "tags"
  | "stashes"
  | "worktrees"
  | "graph"
  | "right-pane"
  | "diff"
  | "console"
  | "overlay";

/** Modifier flags carried by a normalized binding. */
export interface KeyModifiers {
  /** Control is held. */
  readonly ctrl: boolean;
  /** Shift is held. */
  readonly shift: boolean;
  /** Alt or Option is held. */
  readonly alt: boolean;
  /** Command, Meta, or Super is held. */
  readonly meta: boolean;
}

/** A binding normalized to a base key plus explicit modifiers. */
export interface ParsedBinding extends KeyModifiers {
  /** Canonical base key name, such as `p`, `enter`, or `f1`. */
  readonly key: string;
}

/** A value accepted for one action in `config.json` or `keybindings.json`. */
export type BindingValue = string | readonly string[] | null;

/** Action ID to override value map. */
export type KeybindingOverrides = Readonly<Record<string, BindingValue>>;

/** Groups used by help and the command palette. */
export type ActionCategory =
  | "app"
  | "remote"
  | "focus"
  | "navigation"
  | "list"
  | "branch"
  | "tag"
  | "stash"
  | "worktree"
  | "commit"
  | "diff"
  | "graph"
  | "console"
  | "help"
  | "form"
  | "overlay";

/** One entry in the action catalogue. */
export interface ActionDefinition {
  /** Stable action ID from product spec section 6.1. */
  readonly id: string;
  /** Contexts in which the action can run. */
  readonly contexts: readonly KeymapContext[];
  /** Built-in binding strings. */
  readonly defaults: readonly string[];
  /** Human-readable action name used by help and the palette. */
  readonly label: string;
  /** Help and palette grouping. */
  readonly category: ActionCategory;
  /** One-line explanation of what the action does. */
  readonly description: string;
}

/** The minimum of a key event needed to resolve a binding without importing OpenTUI. */
export interface KeyEventLike {
  /** Base key name reported by the terminal. */
  readonly name: string;
  /** Control is held. */
  readonly ctrl: boolean;
  /** Meta or Command is held. */
  readonly meta: boolean;
  /** Shift is held. */
  readonly shift: boolean;
  /** Option or Alt is held. */
  readonly option: boolean;
  /** Raw sequence reported by the terminal. */
  readonly sequence: string;
  /** Super is held, when the terminal reports it separately. */
  readonly super?: boolean;
}

/** Two different actions competing for one key in the same context. */
export interface KeymapConflict {
  /** Context where the collision was found. */
  readonly context: KeymapContext;
  /** Canonical lookup key that collided. */
  readonly key: string;
  /** Display form of the colliding key. */
  readonly displayKey: string;
  /** Action IDs that share the key. */
  readonly actions: readonly string[];
}

/** A key-to-action projection per context together with the collisions found while building it. */
export interface ContextProjection {
  /** Key-to-action maps per context. */
  readonly contexts: ReadonlyMap<KeymapContext, ReadonlyMap<string, string>>;
  /** Collisions found while building the maps. */
  readonly conflicts: readonly KeymapConflict[];
}

/** The settled projection plus the warnings produced by rejecting conflicting overrides. */
export interface ConflictSettlement extends ContextProjection {
  /** One warning per conflict that caused an override to be reset. */
  readonly warnings: readonly string[];
}

/**
 * A fully resolved keymap with action and context projections.
 *
 * The binding and context maps are read-only by contract: `KeymapProvider` memoizes one instance
 * and shares it with every consumer, so callers must not mutate the maps they read.
 */
export interface ResolvedKeymap {
  /** Platform used to expand `mod`. */
  readonly platform: KeymapPlatform;
  /** Effective bindings per action ID. */
  readonly bindings: ReadonlyMap<string, readonly ParsedBinding[]>;
  /** Effective key-to-action lookup per context. */
  readonly contexts: ReadonlyMap<KeymapContext, ReadonlyMap<string, string>>;
  /** Unresolved collisions that remain after rejecting conflicting overrides. */
  readonly conflicts: readonly KeymapConflict[];
  /** Non-blocking resolution and validation warnings. */
  readonly warnings: readonly string[];
}

/** One footer-ready hint derived from the resolved keymap. */
export interface KeymapHint {
  /** Action the hint belongs to. */
  readonly actionId: string;
  /** Human-readable action name. */
  readonly label: string;
  /** Effective bindings formatted for display. */
  readonly keys: readonly string[];
  /** Drop order for the footer; lower values are kept longer. */
  readonly priority: number;
}

/** Filters applied while deriving footer hints. */
export interface KeymapHintOptions {
  /** Reports whether the action has a current handler in the given context. */
  readonly isAvailable?: (actionId: string, scope: KeymapContext) => boolean;
}

/** Inputs for one keymap resolution pass. */
export interface ResolveKeymapOptions {
  /** Overrides from the main configuration file. */
  readonly config?: KeybindingOverrides;
  /** Overrides from the dedicated keybindings file. */
  readonly keybindings?: KeybindingOverrides;
  /** Platform used to expand `mod`; detected from the process when omitted. */
  readonly platform?: KeymapPlatform;
}
