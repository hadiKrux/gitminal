import type { RegionId } from "@/features/shell/focus.types";

/**
 * Context that owns an action handler.
 *
 * The region half is derived from the shell's `RegionId` so adding or renaming a region cannot
 * leave the action registry and the focus model out of sync. The import is type-only, so the app
 * layer gains no runtime dependency on the shell.
 */
export type ActionScope = "global" | "overlay" | RegionId;

/**
 * Designated owners allowed to register global actions.
 *
 * Global actions have exactly one owner: the app composition root, the shell for focus traversal,
 * the always-mounted top bar for remote operations, or the always-mounted diff panel for its
 * global stage-all action.
 */
export type ActionOwner = "app" | "shell" | "top-bar" | "diff";

/** Target kind a handler receives from the command model. */
export type ActionTargetKind =
  | "none"
  | "branch"
  | "remoteBranch"
  | "tag"
  | "stash"
  | "worktree"
  | "commit"
  | "pending"
  | "diffFile"
  | "form";

/** Options accepted by `useAction`. */
export interface ActionRegistrationOptions {
  /** Context the handler runs in. */
  readonly scope: ActionScope;
  /** Target kind the handler understands; defaults to `none`. */
  readonly targetKind?: ActionTargetKind;
  /** Required for global actions to prove a designated owner registered them. */
  readonly owner?: ActionOwner;
}

/** Callback invoked when a resolved action executes. */
export type ActionHandler = () => void;

/** One entry in a batch of action registrations. */
export interface ActionBatchRegistration {
  /** Stable action id. */
  readonly actionId: string;
  /** Scope, target kind, and optional owner. */
  readonly options: ActionRegistrationOptions;
  /** Callback invoked when the action runs. */
  readonly handler: ActionHandler;
}
