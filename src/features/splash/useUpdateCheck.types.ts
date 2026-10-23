import type { UpdateCheckResult } from "@/domain/update/update.types";

/**
 * View state owned by the splash feature while the update check is in flight or settled.
 *
 * The domain only models the settled result. The in-flight `checking` state belongs to the
 * feature because it describes the splash UI lifecycle, not the registry check.
 */
export type UpdateCheckState = { status: "checking" } | UpdateCheckResult;
