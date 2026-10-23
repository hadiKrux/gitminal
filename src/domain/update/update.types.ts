/**
 * Result of a single npm registry update check.
 *
 * `unavailable` covers every silent failure: offline, timeout, HTTP error, and malformed payload.
 */
export type UpdateCheckResult =
  | {
      /** A newer version is published. */
      status: "available";
      /** The version that is currently running. */
      currentVersion: string;
      /** The latest published version. */
      latestVersion: string;
    }
  | {
      /** The running version is current or newer than the registry. */
      status: "up-to-date";
    }
  | {
      /** The check could not produce a trustworthy result. Rendered as nothing. */
      status: "unavailable";
    };

/**
 * Minimal fetch contract used by the update check.
 *
 * Keeping the contract narrow makes the network boundary injectable in tests without adding a
 * dependency or a second HTTP client.
 */
export type UpdateFetcher = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

/**
 * Inputs for a single update check.
 */
export interface CheckForUpdateOptions {
  /** Package name read from the manifest, already scoped when applicable. */
  packageName: string;
  /** Running version read from the manifest. */
  currentVersion: string;
  /** Fetch implementation. Defaults to the runtime global `fetch`. */
  fetchImpl?: UpdateFetcher;
  /** Request timeout in milliseconds. Defaults to `UPDATE_CHECK_TIMEOUT_MS`. */
  timeoutMs?: number;
}

/**
 * Injectable update check contract used by the splash gate.
 *
 * The default implementation is the registry check. The seam lets callers and tests supply a
 * deterministic result without touching the network.
 */
export type CheckForUpdate = (options: CheckForUpdateOptions) => Promise<UpdateCheckResult>;
