import type { ReactNode } from "react";
import type { KeymapPlatform } from "@/domain/keymap/keymap.types";

/** Props accepted by `KeymapProvider`. */
export interface KeymapProviderProps {
  /** Provider content. */
  readonly children?: ReactNode;
  /** Platform used to expand `mod`; detected from the process when omitted. */
  readonly platform?: KeymapPlatform;
}
