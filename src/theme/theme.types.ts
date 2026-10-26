/**
 * Validated `#RRGGBB` color as published by the theme layer.
 *
 * The domain theme module remains the single definition of a validated color. This re-export keeps
 * the UI layer inside its allowed import edges, because `src/ui/**` may read theme types but never
 * imports a domain module directly.
 */
export type { HexColor } from "@/domain/theme/theme.types";
