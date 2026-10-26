/** Seconds in one day. */
const SECONDS_PER_DAY = 86_400;

/** Days after which the age is reported in months. */
const DAYS_PER_MONTH = 30;

/** Days after which the age is reported in years. */
const DAYS_PER_YEAR = 365;

/**
 * Formats a stash commit timestamp as a short relative age.
 *
 * `@/lib/time` does not exist in this tree yet, so the formatter lives with the stash feature. It
 * uses only the record timestamp and the current clock, and it is pure so a test can pin the clock
 * without touching the provider. The largest unit is chosen from one duration calculation, so a
 * value close to a year boundary can never render a rounded-down zero: 360 days is `12mo ago` and
 * 365 days is `1y ago`.
 *
 * @param committedAt - Commit timestamp in seconds since the epoch.
 * @param nowMs - Current clock value in milliseconds. Defaults to `Date.now()`.
 * @returns A compact age such as `just now`, `12m ago`, `3h ago`, `5d ago`, `12mo ago`, or `2y ago`.
 */
export function formatStashAge(committedAt: number, nowMs: number = Date.now()): string {
  if (committedAt <= 0) {
    return "unknown age";
  }

  const seconds = Math.max(0, Math.floor(nowMs / 1000) - committedAt);
  const minutes = Math.floor(seconds / 60);

  if (minutes < 1) {
    return "just now";
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(seconds / SECONDS_PER_DAY);

  if (days < DAYS_PER_MONTH) {
    return `${days}d ago`;
  }

  if (days >= DAYS_PER_YEAR) {
    return `${Math.floor(days / DAYS_PER_YEAR)}y ago`;
  }

  return `${Math.floor(days / DAYS_PER_MONTH)}mo ago`;
}
