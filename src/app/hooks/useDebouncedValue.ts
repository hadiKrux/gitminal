import { useEffect, useState } from "react";

/**
 * Delays a changing value until it has stayed unchanged for a short interval.
 *
 * The hook keeps the last settled value in local state and rewrites it only after the delay elapses.
 * Every change or unmount clears the pending timer, so a burst of input produces one final update
 * instead of one update per keystroke. A non-positive delay settles on the next effect pass.
 *
 * @param value - Current value to debounce.
 * @param delayMs - Quiet interval before the value settles, in milliseconds.
 * @returns The most recent settled value.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    if (delayMs <= 0) {
      setDebouncedValue(value);

      return;
    }

    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);

  return debouncedValue;
}
