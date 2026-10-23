import { isNewerVersion, parseVersion } from "@/lib/semver";
import { NPM_REGISTRY_URL, UPDATE_CHECK_TIMEOUT_MS } from "./update.constants";
import type { CheckForUpdateOptions, UpdateCheckResult, UpdateFetcher } from "./update.types";

/**
 * Checks the npm registry for a newer published version of the app.
 *
 * This is the only network entry point in the app. The request is bounded twice: the fetch
 * receives `AbortSignal.timeout`, and `requestLatestVersion` races the request and parse against
 * one local timer so a fetch implementation that ignores the signal still settles. The check runs
 * once per caller and never blocks; every request, response, or payload failure becomes
 * `unavailable`, which the splash renders as nothing.
 *
 * @param options - Package name, running version, and optional fetch and timeout seams.
 * @returns The settled update result. Never rejects for a request, response, or payload failure.
 */
export async function checkForUpdate(options: CheckForUpdateOptions): Promise<UpdateCheckResult> {
  const {
    packageName,
    currentVersion,
    fetchImpl = fetch,
    timeoutMs = UPDATE_CHECK_TIMEOUT_MS,
  } = options;

  const latestVersion = await requestLatestVersion(packageName, fetchImpl, timeoutMs);

  if (latestVersion === null) {
    return { status: "unavailable" };
  }

  if (!isNewerVersion(latestVersion, currentVersion)) {
    return { status: "up-to-date" };
  }

  return { status: "available", currentVersion, latestVersion };
}

/**
 * Requests the latest distribution metadata and extracts a valid version.
 *
 * The request and payload parsing are the only failure boundary: network errors, non-success
 * responses, invalid JSON, malformed payloads, and timeouts all return `null`. The helper is
 * raced against one local timer, so a fetch implementation that ignores `AbortSignal.timeout` is
 * still bounded. Errors in the version comparison stay outside this catch so a programming defect
 * is not hidden as an offline result.
 *
 * @param packageName - The scoped or unscoped npm package name.
 * @param fetchImpl - The fetch implementation to use.
 * @param timeoutMs - Request timeout in milliseconds.
 * @returns The published version, or `null` for any failed or malformed response.
 */
async function requestLatestVersion(
  packageName: string,
  fetchImpl: UpdateFetcher,
  timeoutMs: number,
): Promise<string | null> {
  try {
    return await withTimeout(
      requestAndParseLatestVersion(packageName, fetchImpl, timeoutMs),
      timeoutMs,
    );
  } catch {
    return null;
  }
}

/**
 * Performs the registry request and parses the published version.
 *
 * @param packageName - The scoped or unscoped npm package name.
 * @param fetchImpl - The fetch implementation to use.
 * @param timeoutMs - Request timeout in milliseconds.
 * @returns The published version, or `null` for a non-successful or malformed response.
 */
async function requestAndParseLatestVersion(
  packageName: string,
  fetchImpl: UpdateFetcher,
  timeoutMs: number,
): Promise<string | null> {
  const url = `${NPM_REGISTRY_URL}/${encodeURIComponent(packageName)}/latest`;
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });

  if (!response.ok) {
    return null;
  }

  const payload: unknown = await response.json();

  return readLatestVersion(payload);
}

/**
 * Rejects when a promise does not settle before the timeout.
 *
 * `AbortSignal.timeout` only bounds fetch implementations that honor the signal. Racing the
 * promise here makes the module's timeout self-enforced. The timer is always cleared so a settled
 * promise leaves no pending work behind.
 *
 * @param promise - The pending request or response body read.
 * @param timeoutMs - Timeout in milliseconds.
 * @returns The promise result when it settles in time.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Update check timed out"));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Reads a valid semantic version from an untrusted registry payload.
 *
 * @param payload - The parsed JSON response body.
 * @returns The version string, or `null` when the payload shape or version is invalid.
 */
function readLatestVersion(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const version = (payload as { version?: unknown }).version;

  if (typeof version !== "string" || parseVersion(version) === null) {
    return null;
  }

  return version;
}
