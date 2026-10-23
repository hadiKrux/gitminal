import { useContext } from "react";
import { KeymapStateContext } from "@/app/providers/KeymapProvider";
import type { ResolvedKeymap } from "@/domain/keymap/keymap.types";

/**
 * Reads the resolved keymap.
 *
 * @returns The resolved action and context projections.
 * @throws When called outside a `KeymapProvider`.
 */
export function useKeymap(): ResolvedKeymap {
  const keymap = useContext(KeymapStateContext);

  if (!keymap) {
    throw new Error("useKeymap must be used within a KeymapProvider.");
  }

  return keymap;
}
