/** Month labels used by the human-readable commit date. */
const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** Weekday labels used by the human-readable commit date. */
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/**
 * Strict ISO 8601 date with an explicit timezone or `Z`, as printed by `%aI` and `%cI`.
 *
 * Seconds and fractional seconds are optional so a hand-written value still formats, while a value
 * without a timezone stays unformatted because its offset would otherwise be invented.
 */
const COMMIT_DATE_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

/**
 * Formats a git strict ISO date as a short, human-readable timestamp.
 *
 * The local clock time and its offset are kept exactly as git reported them, so no timezone
 * conversion happens and the author's wall clock stays visible. The result reads
 * `Sun, 25 Oct 2026 9:30 AM +05:00`. Input that is not a strict ISO date, or that names an
 * impossible calendar date, is returned unchanged so a malformed value is visible instead of
 * guessed.
 *
 * @param iso - Strict ISO 8601 date from `%aI` or `%cI`.
 * @returns The formatted timestamp, or the input when it cannot be formatted.
 */
export function formatCommitDateTime(iso: string): string {
  const match = COMMIT_DATE_PATTERN.exec(iso.trim());

  if (match === null) {
    return iso;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minuteField = match[5];
  const offset = match[7];

  if (
    minuteField === undefined ||
    offset === undefined ||
    !isValidCalendarDate(year, month, day) ||
    hour > 23 ||
    Number(minuteField) > 59
  ) {
    return iso;
  }

  const weekday = WEEKDAY_LABELS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  const time = formatClockTime(hour, minuteField);

  return `${weekday}, ${match[3]} ${MONTH_LABELS[month - 1]} ${year} ${time} ${normalizeOffset(offset)}`;
}

/**
 * Formats the clock portion as a twelve-hour time with an am or pm marker.
 *
 * Midnight becomes `12:00 AM` and noon becomes `12:00 PM`, matching how people read a clock rather
 * than the zero and twelve that a raw hour field holds. Minutes stay zero-padded.
 *
 * @param hour - Hour in the twenty-four-hour clock.
 * @param minute - Minute field from the matched ISO date.
 * @returns The clock time, for example `9:30 PM`.
 */
function formatClockTime(hour: number, minute: string): string {
  const meridiem = hour < 12 ? "AM" : "PM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;

  return `${hour12}:${minute} ${meridiem}`;
}

/**
 * Reports whether the date components name a real calendar day.
 *
 * @param year - Four-digit year.
 * @param month - One-based month.
 * @param day - Day of the month.
 * @returns True when the day exists in that month.
 */
function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return day <= daysInMonth;
}

/**
 * Normalizes a timezone suffix to the `+HH:MM` form.
 *
 * @param offset - Timezone from the matched ISO date, either `Z` or a signed offset.
 * @returns The offset with a colon and without the `Z` shorthand.
 */
function normalizeOffset(offset: string): string {
  if (offset === "Z") {
    return "+00:00";
  }

  if (offset.includes(":")) {
    return offset;
  }

  return `${offset.slice(0, 3)}:${offset.slice(3)}`;
}
