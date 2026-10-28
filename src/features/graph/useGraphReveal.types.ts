import type { ScrollBoxRenderable } from "@opentui/core";
import type { RefObject } from "react";
import type { GraphRevealTarget } from "@/features/graph/graph.types";

/** Inputs for the graph scrollbox reveal hook. */
export interface GraphRevealInput {
  /** Ref attached to the graph panel's own scrollbox. */
  readonly scrollRef: RefObject<ScrollBoxRenderable | null>;
  /** Row the graph wants to keep visible. */
  readonly target: GraphRevealTarget;
  /** Identity of the mounted body, so a body switch can trigger one post-layout reveal. */
  readonly bodyKey: string;
  /** Measured scrollbox viewport height in lines. */
  readonly viewportHeight: number;
  /** Stable id of the first graph row, used to find the row origin below the loading rows. */
  readonly firstRowId: string | null;
}
